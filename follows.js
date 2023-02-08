const Twitter = require('twitter');
const Telegraf = require('telegraf');
const { delayUnlessShutdown } = require('shutin');
const fs = require('fs');
const path = require('path')

const MAX_FRIENDS_COUNT = 4;
const CONFIG_FILE_NAME = "config.json"

const config = require('yargs')
  .env('TTT')
  .options({
    // API max 15 per 15 minutes
    interval: { default: 70, number: true },
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

// get twitter username from array (if we passed multiple users)
let twitterScreenNameIndex = -1
let twitterScreenName = ""
const getTwitterScreenName = () => {
  if (Array.isArray(config.twitterScreenName)) {
    if (twitterScreenNameIndex+1 >= config.twitterScreenName.length) 
      twitterScreenNameIndex = 0
    else 
      twitterScreenNameIndex++
    return config.twitterScreenName[twitterScreenNameIndex]
  } else return config.twitterScreenName
}

// A simple method for testing your bot's authentication token
bot.telegram.getMe().then(botInfo => {
  bot.options.username = botInfo.username;
});

const getConfigFile = () => {
  return path.resolve(__dirname, CONFIG_FILE_NAME)
}

const storeLatestFriends = _ => {
  //console.log(twitterScreenName, "storeLatestFriends", new Date().toISOString(), _)
  const configFile = getConfigFile()
  let data
  if (fs.existsSync(configFile)) {
    data = JSON.parse(fs.readFileSync(configFile, 'utf8'))
    data[twitterScreenName] = _
  } else {
    data = {
      [twitterScreenName]:  _
    }
  }

  fs.writeFile(
    configFile, 
    JSON.stringify(data, null, 4), 
    'utf8', (err) => {
      //if (err) throw err;
      if (err) console.error(err);
    }
  )
}

async function main() {
  
  console.log("config.twitterScreenName", config.twitterScreenName)
  
  //bot.startPolling();

  // Rate limit telegram messages to 1 per second to avoid throtle limits
  const telegramMsgRateLimit = 1000 // 1 second

  const getLastestFriends = () => {
    if (fs.existsSync(getConfigFile())) {
      const data = JSON.parse(fs.readFileSync(getConfigFile(), 'utf8'))
      if (data[twitterScreenName])
        return data[twitterScreenName]
      else 
        return null
    } else {
      return null
    }
  }

  do {

    twitterScreenName = getTwitterScreenName()
    let telegramMsgCount = 0
    const latestFriends = getLastestFriends()

    const friends = await twitter.get('friends/list', {
      screen_name: twitterScreenName,
      count: MAX_FRIENDS_COUNT,
    })
    .catch((error) => {
      console.error(error)
    })

    // If we get an "[ { message: 'Rate limit exceeded', code: 88 } ]" error above
    // friends will be undefined
    
    if (friends != undefined && latestFriends) {      
      //for (const friend of friends.users.slice().reverse()) {
      for (const friend of friends.users.reverse()) {

        if (latestFriends.includes(friend.screen_name)) {
          //console.log(twitterScreenName, "canceling...", friend.screen_name)
          continue;
        }
        console.log(twitterScreenName, "Followed someone", friend.screen_name)
        
        setTimeout( async () => {
          await bot.telegram.sendMessage(
            config.telegramChatId,
            [
              `<a href="https://twitter.com/${twitterScreenName}">@${twitterScreenName}</a> just followed <a href="https://twitter.com/${friend.screen_name}">@${friend.screen_name}</a>`,
              `<b>name:</b> ${friend.name}`,
              `<b>description:</b> ${friend.description}`,
              `<pre>followers_count: ${friend.followers_count}`,
              `friends_count: ${friend.friends_count}`,
              `created_at: ${friend.created_at}</pre>`,
            ].join('\n'),
            //{ parse_mode: 'Markdown' }
            { parse_mode: 'HTML' }
          );  
        }, telegramMsgCount * telegramMsgRateLimit)
        telegramMsgCount++
      }
    }
    if (friends != undefined) {
      const mostRecentFriends = friends.users.map((item) => {
        return item.screen_name
      });
      if (mostRecentFriends.count) await storeLatestFriends(mostRecentFriends)
    }
  } while (!(await delayUnlessShutdown(config.interval * 1000)));
}

main().then(process.exit);
