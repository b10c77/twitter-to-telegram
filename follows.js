const Twitter = require('twitter');
const Telegraf = require('telegraf');
const { delayUnlessShutdown } = require('shutin');
const fs = require('fs');
const path = require('path')

const MAX_FRIENDS_COUNT = 5;

const config = require('yargs')
  .env('TTT')
  .options({
    // API max 15 per 15 minutes
    interval: { default: 90, number: true },
    telegramChatId: { demandOption: true },
    telegramBotToken: { demandOption: true },
    twitterScreenName: { demandOption: true },
    twitterConsumerKey: { demandOption: true },
    twitterConsumerSecret: { demandOption: true },
    twitterAccessTokenKey: { demandOption: true },
    twitterAccessTokenSecret: { demandOption: true },
  }).argv;

const twitter = new Twitter({
  consumer_key: config.twitterConsumerKey,
  consumer_secret: config.twitterConsumerSecret,
  access_token_key: config.twitterAccessTokenKey,
  access_token_secret: config.twitterAccessTokenSecret,
});

const bot = new Telegraf(config.telegramBotToken);

let twitterScreenNameIndex = 0 
let twitterScreenName = ""
const getTwitterScreenName = () => {
  if (Array.isArray(config.twitterScreenName)) {
    if (twitterScreenNameIndex+1 >= config.twitterScreenName.length) 
      twitterScreenNameIndex = 0
    else 
      twitterScreenNameIndex++
    return config.twitterScreenName[twitterScreenNameIndex]
  }
  else return config.twitterScreenName
}

bot.telegram.getMe().then(botInfo => {
  bot.options.username = botInfo.username;
});

const getConfigFile = () => {
  return path.resolve(__dirname, twitterScreenName)
}

const storeSinceId = _ => {
  console.log("storeSinceId", new Date().toISOString(), _)
  fs.writeFile(
    getConfigFile(), 
    JSON.stringify({sinceId: _}, null, 4), 
    'utf8', (err) => {
      //if (err) throw err;
      if (err) console.error(err);
    }
  )
}

async function main() {
  
  console.log("config.twitterScreenName", config.twitterScreenName)
  
  bot.startPolling();

  // Rate limit telegram messages to 1 per second to avoid throtle limits
  const telegramMsgRateLimit = 1000 // 1 second

  const getLastFriendId = () => {
    if (fs.existsSync(getConfigFile())) {
      const data = JSON.parse(fs.readFileSync(getConfigFile(), 'utf8'))
      //console.log("getSinceId", new Date().toISOString(), data)
      return data.sinceId
    } else {
      //errMsg = `File ${config.twitterScreenName} does not exist`;
      //console.log(errMsg);
      //throw errMsg;
      return null
    }
  }

  do {

    twitterScreenName = getTwitterScreenName()
    let telegramMsgCount = 0
    const sinceId = getLastFriendId()

    const friends = await twitter.get('friends/list', {
      screen_name: twitterScreenName,
      count: MAX_FRIENDS_COUNT,
    });
    //console.log(friends)

    if (sinceId) {
      
      for (const friend of friends.users.slice().reverse()) {
        // Stop relaying once the most recently relayed tweet is reached
        if (friend.id <= +sinceId) {
          console.log("canceling...", friend.id, +sinceId)
          continue;
        }

        console.log("Followed someone", friend.screen_name)
        setTimeout( async () => {
          await bot.telegram.sendMessage(
            config.telegramChatId,
            [
              `@${twitterScreenName} just followed ${friend.screen_name}`,
              `followers_count: ${friend.followers_count}`,
              `friends_count: ${friend.friends_count}`,
              `created_at: ${friend.created_at}`,
            ].join('\n'),
            { parse_mode: 'Markdown' }
            //{ parse_mode: 'HTML' }
          );
  
          //await storeSinceId(tweet.id_str);
          await storeSinceId(friend.id);
        }, telegramMsgCount * telegramMsgRateLimit)
        telegramMsgCount++
      }
    } else {
      const [mostRecentTweet] = friends.users;

      if (mostRecentTweet) {
        //await storeSinceId(mostRecentTweet.id_str);
        await storeSinceId(mostRecentTweet.id);
      }
    }
  } while (!(await delayUnlessShutdown(config.interval * 1000)));
}

main().then(process.exit);
