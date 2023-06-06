const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const { JSDOM } = require('jsdom');
let ready = false;

const urlsToSearch = [
  "https://www.chesterton.org/quotations/essential-chesterton/",
  "https://www.chesterton.org/quotations/timeless-truths/",
  "https://www.chesterton.org/quotations/FREE-ADVICE/",
  "https://www.chesterton.org/quotations/the-cult-of-progress/",
  "https://www.chesterton.org/quotations/war-and-politics/",
  "https://www.chesterton.org/quotations/government-and-politics/",
  "https://www.chesterton.org/quotations/SOCIETY-AND-CULTURE/",
  "https://www.chesterton.org/quotations/love-and-marriage/",
  "https://www.chesterton.org/quotations/RELIGION-AND-FAITH/",
  "https://www.chesterton.org/quotations/CHRISTMAS/",
  "https://www.chesterton.org/quotations/MORALITY-AND-TRUTH/",
  "https://www.chesterton.org/quotations/economic-theory-and-distributism/",
  "https://www.chesterton.org/quotations/ART-AND-LITERATURE/",
  "https://www.chesterton.org/quotations/todays-dilemmas/",
  "https://www.chesterton.org/quotations/ATHEISM/",
  "https://www.chesterton.org/quotations/LIBERTY/",
  "https://www.chesterton.org/quotations/COURAGE/",
  "https://www.chesterton.org/quotations/FRIENDSHIP/"
];

const quotes = [];
let allQuotes = [];

async function getAllQuotes(urls) {
  const allQuotes = [];
  for (const url of urls) {
    const response = await axios.get(url);
    const html = response.data;
    const dom = new JSDOM(html);
    const quotes = Array.from(dom.window.document.querySelectorAll('p'))
      .filter(p => /["“”]/.test(p.textContent))
      .map(p => p.textContent.trim());
    allQuotes.push(...quotes);
  }
  return allQuotes;
}

async function prepareQuotes() {
	console.log("Collecting quotes...");
	allQuotes = await getAllQuotes(urlsToSearch);
	console.log("Ready to quote!");
	const randomQuote = allQuotes[Math.floor(Math.random() * allQuotes.length)];
	console.log(randomQuote);
	ready = true;
}

prepareQuotes();

module.exports = {
	data: new SlashCommandBuilder()
		.setName('quote')
		.setDescription('Replies with a random Chesterton quote!'),
	async execute(interaction) {
		if (ready) {
			const randomQuote = allQuotes[Math.floor(Math.random() * allQuotes.length)];
			console.log("quote selected...");
			await interaction.reply(randomQuote);
		} else {
			await interaction.reply("Hold on, I am still thinking.");
		}
	},
	allQuotes
};

