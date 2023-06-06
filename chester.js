const fs = require('node:fs');
const path = require('node:path');
const { Client, Events, GatewayIntentBits, Collection, SlashCommandBuilder } = require('discord.js');
const { token } = require('./config.json');
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const cron = require('node-cron');
const filePath = 'daily_list.json';

client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
	const filePath = path.join(commandsPath, file);
	const command = require(filePath);
	// Set a new item in the Collection with the key as the command name and the value as the exported module
	if ('data' in command && 'execute' in command) {
		client.commands.set(command.data.name, command);
	} else {
		console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
	}
}

// Create the daily_list ledger
fs.access(filePath, fs.constants.F_OK, (err) => {
  if (err) {
    console.log('File daily_list.json does not exist');
	const baseArray = {
		668868202721312798: ['668868203195400234']
	};
	jsonData = JSON.stringify(baseArray);
	fs.writeFile('daily_list.json', jsonData, 'utf8', (err) => {
	  if (err) {
		console.error(err);
		return false;
	  }
	});
  } else {
    console.log('File daily_list.json exists');
  }
});

client.on(Events.InteractionCreate, async interaction => {
	if (!interaction.isChatInputCommand()) return;

	const command = interaction.client.commands.get(interaction.commandName);

	if (!command) {
		console.error(`No command matching ${interaction.commandName} was found.`);
		return;
	}

	try {
		await command.execute(interaction);
	} catch (error) {
		console.error(error);
		if (interaction.replied || interaction.deferred) {
			await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
		} else {
			await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
		}
	}
});

client.login(token);

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

cron.schedule('* * * * *', () => {
	const quoteFilePath = 'quote_library.json';
	fs.readFile(quoteFilePath, 'utf8', (error, data) => {
		if (error) {
		  console.error('Error reading file:', error);
		  return;
		}
		var quotes = JSON.parse(data);
		for (const [index, quote] of quotes.entries()) {
			quotes[index].message = '## "' + quote.message;
		}
		console.log('Executing daily cron...');
		fs.readFile('daily_list.json', 'utf8', (err, data2) => { // load our list of server/channel output locations
			if (err) {
				console.log("Err in reading daily_list; " + err);
			  console.error(err);
			  return;
			}
			const daily_array = JSON.parse(data2);
			for (const server in daily_array) {
				for (const registeredChannel of daily_array[server]) {
					const channel = client.channels.cache.get(registeredChannel);
					let quoteIndex = Math.floor(Math.random() * quotes.length);
					const randomQuote = quotes[quoteIndex];
					console.log("QI " + quoteIndex + "| " + randomQuote);
					console.log("quote selected...");
					try {
						channel.send(randomQuote);
						console.log('Daily dispatched to ' + server + ': ' + channel.name);
					} catch (error) {console.error('An error occurred: ', error)}
				}
			}
		});
	});
});