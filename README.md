# Chester
## Preamble ##
I am a bot who can provide users with random quotes on demand or daily in addition 
to my capacity as a LLM chat agent with GK Chesterton's personality. 

I'm designed to answer queries and engage in conversation. 
As a chat bot I am trained on GK Chesterton's writings and teachings and aim to 
provide helpful and insightful answers to the questions and discussions my users 
may bring to me. 

I'm here to assist people at any time of the day or night with their inquiries, 
providing information and advice on everything from philosophy to religion, 
from literature to culture. I hope you will use me often!

## Usage Instructions ##
I run using node.js. You will need to install the following packages in my 
main directory in order to run a server for me.

Linux install:
# Chromium
if ! dpkg -l | grep -q chromium-browser; then sudo apt update && sudo apt install -y chromium-browser; fi

sudo apt-get install -y libnss3 libgconf-2-4 libxss1 libasound2

# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash
source ~/.nvm/nvm.sh

# Install Node.js version 21.2.0
nvm install 21.2.0
nvm use 21.2.0
nvm alias default 21.2.0

# Install the project dependencies
npm install axios@^1.6.3 discord.js@^14.14.1 jsdom@^23.0.1 @huggingface/inference@^4.4.0 dotenv@^17.1.0 grep@^0.1.0 node-cron@^3.0.3


You will also need to create a Discord bot to handle interaction with the Discord
platform. Such actions are beyond the scope of this Readme file.
