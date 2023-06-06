/*
 * Command: /daily
 * Registers the current channel to receive a daily random quote at 6 am EST
 *
 */



const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('node:fs');

const filePath = 'daily_list.json';

// Using fs.access()
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

function registerChannel(guild,channel,daily_array) {
	/*
	 * guild = guild array key
	 * returns "ok" if complete, "rem" if the channel was removed, and "err" if an error occurred.
	 * TODO: Write the updated daily_list back to the json file
	 */
  let output = "ok";
	if (guild in daily_array == false) { // If this is a new server, register it in the array
    daily_array[guild] = [];
  }
	if (daily_array[guild].includes(channel)) { // if this is NOT a new channel, remove it from the server's list of channels to include in the daily
		// This channel is already registered!
    let channelIndex = daily_array[guild].indexOf(channel);
    daily_array[guild].splice(channelIndex,1);
    output = "rem";
  } else { // this is a new channel, so add it to the server's list of channels to include in the daily
		daily_array[guild].push(channel);
    output = "ok";
	}
  if (daily_array[guild].length === 0) { // if the server no longer has any channels in its list, remove the server from the daily_array
    delete daily_array[guild];
  }
	jsonData = JSON.stringify(daily_array);
	fs.writeFile('daily_list.json', jsonData, 'utf8', (err) => {
	  if (err) {
		console.error(err);
		output = "err";
	  }
	});
	
	return output;
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('daily')
		.setDescription('Registers the current channel to receive a random quote every day at 6 am EST.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
	execute(interaction) {
		fs.readFile('daily_list.json', 'utf8', (err, data) => {
			if (err) {
			  console.error(err);
			  return;
			}
			const daily_array = JSON.parse(data);
			console.log(daily_array);
			output = registerChannel(interaction.guildId, interaction.channelId, daily_array); // "ok" | "rem" | "err"
			if (output == "ok") { // channel registered
				console.log('Daily list has been updated to include ' + interaction.guild.name + ': ' + interaction.channel.name);
				interaction.reply('Daily list has been updated to include ' + interaction.guild.name + ': ' + interaction.channel.name);
			} else if (output == "rem") { // channel unregistered
				interaction.reply("This channel has been unregistered from the daily list!");
				console.log('Daily list has been updated, removing ' + interaction.guild.name + ': ' + interaction.channel.name);
			} else { // error occurred
				interaction.reply("Oops, something went wrong. Sorry about that.");
				console.log('Err updating daily for ' + interaction.guild.name + ': ' + interaction.channel.name);
			}
		});
	}
};

