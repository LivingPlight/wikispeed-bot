import 'dotenv/config';
import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import cron from 'node-cron';
import fetch from 'node-fetch';
import fs from 'fs';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

const LB_FILE = './leaderboard.json';
let leaderboard = fs.existsSync(LB_FILE) ? JSON.parse(fs.readFileSync(LB_FILE)) : {};

function saveLeaderboard() {
  fs.writeFileSync(LB_FILE, JSON.stringify(leaderboard, null, 2));
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(3).replace(/\.?0+$/, '');
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function parseResult(text) {
  const clicksMatch = text.match(/(\d+)\s*🖱️/);
  const timeMatch = text.match(/([\d.]+)\s*⏱️/);
  if (!clicksMatch || !timeMatch) return null;
  return {
    clicks: parseInt(clicksMatch[1]),
    timeSeconds: parseFloat(timeMatch[1]),
  };
}

async function getDailyPrompt() {
  const res = await fetch('https://wikispeedruns.com/api/sprints/active');
  const data = await res.json();
  console.log('API response:', JSON.stringify(data[0]));
  return data[0];
}

async function postPaths(channel) {
  const paths = leaderboard.paths ?? [];
  if (paths.length === 0) return;
  const promptId = leaderboard.promptId ?? '?';
  for (const { user, path } of paths) {
    const pathEmbed = new EmbedBuilder()
      .setTitle(`🗺️ ${user}'s Path`)
      .setColor(0x9b59b6)
      .setDescription(path)
      .setFooter({ text: `Prompt #${promptId}` });
    await channel.send({ embeds: [pathEmbed] });
  }
}

async function postDailyPrompt() {
  const channel = await client.channels.fetch(CHANNEL_ID);

  await postPaths(channel);

  const prompt = await getDailyPrompt();

  leaderboard = { date: prompt.active_start, promptId: prompt.prompt_id, byTime: [], byClicks: [], paths: [] };
  saveLeaderboard();

  const embed = new EmbedBuilder()
    .setTitle('🏁 Daily WikiSpeedruns Prompt!')
    .setColor(0x3498db)
    .addFields(
      { name: 'Start', value: `**${prompt.start}**`, inline: true },
      { name: 'End', value: `**${prompt.end ?? 'Check the site!'}**`, inline: true },
    )
    .setURL(`https://wikispeedruns.com/play/${prompt.prompt_id}`)
    .setDescription(
      `[▶ Play today's prompt](https://wikispeedruns.com/play/${prompt.prompt_id})\n\n` +
      `When you're done, use \`/submit\` with two copy-pastes from the results screen:\n\n` +
      `📋 **result** — hit the main **Copy** button (gives you time + clicks)\n` +
      `🗺️ **path** — hit the **Share Path** button`
    )
    .setFooter({ text: `Prompt #${prompt.prompt_id} • ${prompt.active_start}` });

  await channel.send({ embeds: [embed] });
}

client.on('error', console.error);

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {

    if (interaction.commandName === 'submit') {
      const resultText = interaction.options.getString('result');
      const path = interaction.options.getString('path');
      const user = interaction.user.username;

      const parsed = parseResult(resultText);
      if (!parsed) {
        return interaction.reply({ content: 'Could not parse your result — paste the full copied text from WikiSpeedruns (it should contain 🖱️ and ⏱️).', ephemeral: true });
      }

      const { clicks, timeSeconds } = parsed;
      const timeFormatted = formatTime(timeSeconds);

      if (!leaderboard.byTime) {
        return interaction.reply({ content: 'No active prompt today yet!', ephemeral: true });
      }

      leaderboard.byTime = leaderboard.byTime.filter(e => e.user !== user);
      leaderboard.byClicks = leaderboard.byClicks.filter(e => e.user !== user);
      leaderboard.paths = (leaderboard.paths ?? []).filter(e => e.user !== user);

      leaderboard.byTime.push({ user, time: timeFormatted, timeSeconds, clicks });
      leaderboard.byClicks.push({ user, time: timeFormatted, timeSeconds, clicks });
      if (path) leaderboard.paths.push({ user, path });

      leaderboard.byTime.sort((a, b) => a.timeSeconds - b.timeSeconds);
      leaderboard.byClicks.sort((a, b) => a.clicks - b.clicks);

      saveLeaderboard();

      await interaction.reply(`✅ **${user}** finished in **${timeFormatted}** with **${clicks} clicks**! Paths will be revealed when tomorrow's prompt drops.`);
    }

    if (interaction.commandName === 'leaderboard') {
      if (!leaderboard.byClicks || leaderboard.byClicks.length === 0) {
        return interaction.reply('No scores submitted yet today!');
      }

      const byTime = leaderboard.byTime
        .map((e, i) => `${i + 1}. **${e.user}** — ${e.time}, ${e.clicks} clicks`)
        .join('\n');

      const byClicks = leaderboard.byClicks
        .map((e, i) => `${i + 1}. **${e.user}** — ${e.clicks} clicks, ${e.time}`)
        .join('\n');

      const embed = new EmbedBuilder()
        .setTitle("📊 Today's Leaderboard")
        .setColor(0x2ecc71)
        .addFields(
          { name: '⏱️ Fastest Time', value: byTime },
          { name: '🖱️ Fewest Clicks', value: byClicks },
        );

      await interaction.reply({ embeds: [embed] });
    }

  } catch (err) {
    console.error('Interaction error:', err);
  }
});

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const commands = [
    {
      name: 'submit',
      description: 'Submit your speedrun result',
      options: [
        { name: 'result', description: 'Paste the copied result from the WikiSpeedruns results screen', type: 3, required: true },
        { name: 'path', description: 'Paste your path from the WikiSpeedruns Share Path button', type: 3, required: true },
      ],
    },
    {
      name: 'leaderboard',
      description: "Show today's leaderboard",
    },
  ];

  await client.application.commands.set([]);

  const channel = await client.channels.fetch(CHANNEL_ID);
  await channel.guild.commands.set(commands);
  console.log('Slash commands registered!');

  cron.schedule('0 0 * * *', postDailyPrompt, { timezone: 'America/Denver' });
  postDailyPrompt();
});

client.login(TOKEN);
