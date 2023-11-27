const { dir } = require('console');
const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

function getSubDirectories(directoryPath) {
  // Read the contents of the directory
  const contents = fs.readdirSync(directoryPath);

  // Filter out subdirectories
  const subDirectories = contents.filter((item) => {
    // Check if the item is a directory
    return fs.statSync(path.join(directoryPath, item)).isDirectory();
  });

  return subDirectories;
}

const directoryPath = `library`;
const library_titles = getSubDirectories(directoryPath);
const wait = require('node:timers/promises').setTimeout;

module.exports = {
	data: new SlashCommandBuilder()
		.setName('library')
		.setDescription('Provides a list of the existing library or a particular library entry, if specified and valid.')
    .addStringOption(option =>
      option.setName('title')
      .setDescription('The title of the manuscript you are looking for. Partial matches are acceptable.')
      .setMaxLength(50)),
	async execute(interaction) {
    const title = interaction.options.getString('title') ?? 'all';
    if (title == 'all') {
      response = "Here are all of the titles I have available: \n\n";
      library_titles.forEach((value, index) => {
        response = response + `${index + 1}: ` + value.replace(/_/g, ' ') + '\n'
      });
      await interaction.reply(response);
    } else {
      await interaction.deferReply();
      let found = false;
      library_titles.forEach((value) => {
        if (value.toLowerCase().includes(title.toLowerCase())) {
          const subDirectoryPath = path.join(directoryPath, value);
          fs.readdir(subDirectoryPath, (err, files) => {
            if (err) {
              console.error('Error reading directory:', err);
              return;
            }
          
            // Filter out only text files (.txt extension)
            const textFiles = files.filter(file => {
              const ext = path.extname(file).toLowerCase();
              return ext === '.txt' || ext === '.pdf';
            });
          
            if (textFiles.length > 0) {
              const firstTextFile = textFiles[0];
              console.log('First text file:', firstTextFile);
              
              // Now you can use this filename to read the file or perform operations
              const filePath = path.join(subDirectoryPath, firstTextFile);
              const attachment = new AttachmentBuilder(filePath);
              const announcement = 'Here is your requested copy of ' + value.replace(/_/g, ' ') + '!';
              interaction.editReply( { content: announcement, files: [attachment] })
                .catch(err => {
                  console.error('Error sending attachment: ', err);
              });
              found = true;
              return;
            } else {
              console.log('No acceptable files found in the directory.');
            }
          });
        }
      });
      await wait(5000);
      if (!found) {
        await interaction.editReply("My deepest apologies, but I could not find the title you requested. Use '/library all' "+
          "to see my full collection.");
      }
    }
	}
};

