const fs = require('node:fs');
const fsp = require('node:fs').promises;
const path = require('node:path');
require('dotenv').config();
const { Client, Events, GatewayIntentBits, Collection, SlashCommandBuilder } = require('discord.js');
const {
	cleanMessageContent,
	splitMessageBySentence,
} = require('./utils');
const llm = require('./llm');
const analytics = require('./analytics');
const analyticsReport = require('./analyticsReport');

/**
 * Environment-based Bot Credential Selection
 * 
 * APP_ENV determines which bot credentials are used:
 * - "dev" (default): Uses TEST_DISCORD_TOKEN and TEST_DISCORD_CLIENT_ID
 * - "prod": Uses PROD_DISCORD_TOKEN and PROD_DISCORD_CLIENT_ID
 * 
 * Set APP_ENV in .env file to switch between test and production bots.
 */
const APP_ENV = process.env.APP_ENV || 'dev';
const discordToken = APP_ENV === 'prod'
	? process.env.PROD_DISCORD_TOKEN
	: process.env.TEST_DISCORD_TOKEN;
const discordClientId = APP_ENV === 'prod'
	? process.env.PROD_DISCORD_CLIENT_ID
	: process.env.TEST_DISCORD_CLIENT_ID;

console.log(`[INFO] Environment: ${APP_ENV}`);
console.log(`[INFO] Using bot: ${APP_ENV === 'prod' ? 'PRODUCTION' : 'TEST'}`);

const discordClient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
const cron = require('node-cron');
const filePath = 'daily_list.json';

// User timers; these are to prevent spam
const userTimers = {
	// Handles command timers for individual users to prevent spam.
	// userID: timestamp_of_last_activity
};

const commandsWithDelays = [
	// commands which require a delay after execution
	"library", "ping", "quote"
];

function updateTimers() {
	/*
	* Every time a command is received, update all timer entries, removing those which have expired
	*/
	//console.log('Updating timers...');
	const currentTime = Math.floor(Date.now() / 1000);
	const expirationThreshold = 5; // number of seconds required to have expired before the user is removed from the list
	for (const [user, timestamp] of Object.entries(userTimers)) {
		if ((currentTime - timestamp) > expirationThreshold) {
			delete userTimers[user]; // this user's time has expired, so take them off the list, allowing them to use the command again
			console.log('User ' + user + ' removed from the list!');
		}
	}
}

// Chatbot setup

const { getRandomPrompt } = require('./promptSelector');

/**
 * Sends the conversation prompt to the LLM via automatic waterfall model fallback.
 * Returns the assistant's reply text, cleaned for Discord output.
 * Falls back to a user-friendly message if every model is exhausted.
 *
 * @param {string[]} promptLines  Array of user message strings.
 * @returns {Promise<string>}
 */
async function sendPromptToAI(promptLines) {
	const systemPrompt = getRandomPrompt();

	const messages = [
		{ role: 'system', content: systemPrompt },
		...promptLines.map(line => ({ role: 'user', content: line })),
	];

	try {
		const { text, model } = await llm.chat(messages, {
			max_tokens: 8192,
			temperature: 1,
		});
		analytics.recordLlmCall(true, model).catch(() => { });
		return cleanMessageContent(text);
	} catch (err) {
		console.error('[Chester] All LLM models exhausted:', err.message);
		analytics.recordLlmCall(false).catch(() => { });
		return "Dear me, I am rather tired at this time. Please try again later.";
	}
}

// Run startup test only in development mode
if (process.env.APP_ENV === 'dev') {
	sendPromptToAI(["Hello to you."]).then(testAi => {
		console.log(testAi);
	});
}

// end Chatbot setup

discordClient.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
	const filePath = path.join(commandsPath, file);
	const command = require(filePath);
	// Set a new item in the Collection with the key as the command name and the value as the exported module
	if ('data' in command && 'execute' in command) {
		discordClient.commands.set(command.data.name, command);
	} else {
		console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
	}
}

// Create the daily_list ledger
(async () => {
	try {
		await fsp.access(filePath, fs.constants.F_OK);
		console.log('File daily_list.json exists');
	} catch (err) {
		console.log('File daily_list.json does not exist');
		const baseArray = {
			668868202721312798: ['668868203195400234']
		};
		try {
			await fsp.writeFile('daily_list.json', JSON.stringify(baseArray), 'utf8');
		} catch (writeErr) {
			console.error('Error creating daily_list.json:', writeErr);
		}
	}
})();

discordClient.on(Events.InteractionCreate, async interaction => {
	console.log(`${interaction.user.tag} in #${interaction.channel.name} triggered an interaction.`);
	if (interaction.isChatInputCommand()) {
		const command = interaction.client.commands.get(interaction.commandName);
		if (!command) {
			console.error(`No command matching ${interaction.commandName} was found.`);
			return;
		}
		let user_ready_for_command = false;
		if (commandsWithDelays.includes(interaction.commandName)) {
			updateTimers();
			const userID = interaction.user.id;
			if (userTimers.hasOwnProperty(userID) == false) {
				userTimers[userID] = Math.floor(Date.now() / 1000); // add user to the userTimers delay list
				user_ready_for_command = true;
			} else {
				await interaction.reply({ content: 'Sorry, but you must wait a few seconds before using this command again.', ephemeral: true });
			}
		} else {
			user_ready_for_command = true;
		}
		if (user_ready_for_command) {
			try {
				await command.execute(interaction);
				analytics.recordCommand(interaction.commandName).catch(() => { });
			} catch (error) {
				console.error(error);
				if (interaction.replied || interaction.deferred) {
					await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
				} else {
					await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
				}
			}
		}
	} else {
		console.log(interaction);
		return;
	}
});

discordClient.login(discordToken);

discordClient.on('clientReady', () => {
	console.log(`Logged in to Discord as ${discordClient.user.tag}!`);
});

discordClient.on('messageCreate', async (message) => {
	console.log("A message!");
	try {
		if (message.author.bot) { return false; } // Do not respond to this bot's own messages. That would be silly.
		if (message.mentions.everyone || message.content.includes('@everyone') || message.content.includes('@here')) {
			return; // Check if the message mentions @everyone or @here.
		}
		let mentionedRoles = [];
		if (message.mentions.roles.size > 0) {
			// Iterate over the mentioned roles.
			message.mentions.roles.forEach((mentionedRole) => {
				const roleName = mentionedRole.name;
				const roleId = mentionedRole.id;

				console.log(`Mentioned Role: ${roleName} (ID: ${roleId})`);
				mentionedRoles.push(roleId);
			});
		}

		let bot_Chester_rolename_used = false;
		if (mentionedRoles.size > 0) {
			mentionedRoles.forEach(mentionedRole => {
				const roleName = mentionedRole.name;
				if ((roleName == "Chester") && (discordClient.user.roles.cache.has(mentionedRole))) { // if the bot has a role named "Chester", which is common, and a user mentions that role,
					bot_Chester_rolename_used = true; // count it as a mention
				}
			});
		}
		if ((message.mentions.has(discordClient.user)) || (bot_Chester_rolename_used)) {
			// Respond to the mention
			console.log('--- Message sent to AI... ---');
			analytics.recordChat(message.guildId).catch(() => { });

			// Fetch the most recent 10 messages from the channel and sort them in chronological order.
			const fetchedMessages = await message.channel.messages.fetch({ limit: 10 });
			const sortedMessages = fetchedMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
			const context = sortedMessages.map(m => `${m.author.username}: ${m.content}`);

			// Combine the context with the current message and reinforcement text.
			const contextArray = context.map(item => "Context: " + item);
			const fullPrompt = [message.content, ...contextArray];

			// Validate prompt before sending
			if (!fullPrompt || fullPrompt.length === 0 || !message.content.trim()) {
				await message.reply("I'm not sure what you meant to say. Could you please try again?");
				return;
			}

			// Send placeholder message
			let placeholderMessage;
			try {
				placeholderMessage = await message.reply("*Chester is thinking...*");
			} catch (error) {
				console.error('Error sending placeholder message: ' + error);
				return;
			}

			let response = "";
			try {
				response = await sendPromptToAI(fullPrompt);
			} catch (error) {
				console.error('Error conversing with LLM: ' + error);
				try {
					await placeholderMessage.edit("My apologies, but I'm a bit confused with what you were saying. Would you mind trying again?");
				} catch (editError) {
					console.error('Error editing placeholder message: ' + editError);
					await message.reply("My apologies, but I'm a bit confused with what you were saying. Would you mind trying again?");
				}
				return;
			}
			console.log('--- RESPONSE FROM BOT ---');
			console.log(response);

			// Split the response into messages that respect Discord's 2000 character limit
			const splitMessages = splitMessageBySentence(response);

			// Replace the placeholder with the first response message
			if (splitMessages.length > 0) {
				try {
					await placeholderMessage.edit(splitMessages[0]);
				} catch (editError) {
					console.error('Error editing placeholder message: ' + editError);
					await message.reply(splitMessages[0]);
				}

				// Send any additional messages if the response was split
				for (let i = 1; i < splitMessages.length; i++) {
					await message.reply(splitMessages[i]);
				}
			}
		}
	} catch (error) {
		console.log("Error in LLM messaging: " + error);
	}

});

// end Chatbot interaction

// ---------------------------------------------------------------------------
// Analytics: uptime heartbeat — fires every minute
// ---------------------------------------------------------------------------
cron.schedule('* * * * *', () => {
	analytics.recordUptimeTick().catch(() => { });
});

// ---------------------------------------------------------------------------
// Analytics: weekly report — every Monday at 09:00 UTC
// ---------------------------------------------------------------------------
cron.schedule('0 9 * * 1', async () => {
	try {
		console.log('[Analytics] Generating weekly report...');
		const currentServerCount = discordClient.guilds.cache.size;
		const snapshot = await analytics.getSnapshotAndReset(currentServerCount);
		await analyticsReport.sendReport(snapshot);
	} catch (err) {
		console.error('[Analytics] Weekly report failed:', err.message);
	}
}, { timezone: 'UTC' });

// ---------------------------------------------------------------------------
// Daily quote cron — fires at 06:00 EST every day
// ---------------------------------------------------------------------------
cron.schedule('0 6 * * *', async () => {
	try {
		const quoteFilePath = 'quote_library.json';
		const quoteData = await fsp.readFile(quoteFilePath, 'utf8');
		const quotes = JSON.parse(quoteData);

		// Add formatting to quotes
		for (const [index, quote] of quotes.entries()) {
			quotes[index].message = '## "' + quote.message;
		}

		console.log('Executing daily cron...');

		const dailyData = await fsp.readFile('daily_list.json', 'utf8');
		const daily_array = JSON.parse(dailyData);

		for (const server in daily_array) {
			for (const registeredChannel of daily_array[server]) {
				try {
					const channel = discordClient.channels.cache.get(registeredChannel);
					if (!channel) {
						console.warn(`Channel ${registeredChannel} not found`);
						continue;
					}

					const quoteIndex = Math.floor(Math.random() * quotes.length);
					const randomQuote = quotes[quoteIndex];
					console.log(`QI ${quoteIndex}: ${randomQuote}`);

					const quoteString = typeof randomQuote === 'object' ? JSON.stringify(randomQuote) : String(randomQuote);
					const splitQuotes = splitMessageBySentence(quoteString);

					for (const quoteMsg of splitQuotes) {
						await channel.send(quoteMsg);
					}

					console.log(`Daily dispatched to ${server}: ${channel.name}`);
				} catch (error) {
					console.error(`Error sending daily quote to ${registeredChannel}:`, error);
				}
			}
		}
	} catch (error) {
		console.error('Error in daily cron job:', error);
	}
});