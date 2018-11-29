# A Confluence Powered Slack Bot (hackathon)

This bot consumes a table from a page on Confluence and uses Logistic Regression Classifiers to return the most accurate response to the end-user.

## Setup
- copy `.env-sample` to `.env` and update the creds/api keys
- edit the `faqPageId` var to the confluence page you want to parse
- run `npm start` to test

## Usage
- Type `help` and the bot will tell you what it's trained for
- Type `!uptime` to see how long it has been up
- Type `!update` every time you change the confluence page, this will pull in the latest training data

## Deploy
- Can be easily pushed to heroku
