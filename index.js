const Twitter = require('twitter');
const Telegraf = require('telegraf');
const { delayUnlessShutdown } = require('shutin');
const { promisifyAll } = require('bluebird');
const isProduction = process.env.NODE_ENV === 'production';
const fs = require('fs');
const path = require('path')

// "because the count parameter retrieves that many Tweets before filtering out retweets and replies."
const MAX_TWEET_COUNT = 3;

const config = require('yargs')
  .env('TTT')
  .options({
    interval: { default: 60, number: true },
    telegramChatId: { demandOption: true },
    telegramBotToken: { demandOption: true },
    twitterScreenName: { demandOption: true },
    redisUrl: { demandOption: isProduction, default: process.env.REDIS_URL },
    twitterConsumerKey: { demandOption: true },
    twitterConsumerSecret: { demandOption: true },
    twitterAccessTokenKey: { demandOption: true },
    twitterAccessTokenSecret: { demandOption: true },
  }).argv;

//const redis = require('redis');
//promisifyAll(redis);
//const redisClient = redis.createClient(config.redisUrl);

const twitter = new Twitter({
  consumer_key: config.twitterConsumerKey,
  consumer_secret: config.twitterConsumerSecret,
  access_token_key: config.twitterAccessTokenKey,
  access_token_secret: config.twitterAccessTokenSecret,
});

const bot = new Telegraf(config.telegramBotToken);

bot.telegram.getMe().then(botInfo => {
  bot.options.username = botInfo.username;
});

/*
const redisKeyPrefix = [
  config.twitterScreenName,
  config.telegramBotToken.split(/:/)[0],
  config.telegramChatId,
].join('_');
*/

//const storeSinceId = _ => redisClient.setAsync(`${redisKeyPrefix}:sinceId`, _);

const getConfigFile = () => {
  return path.resolve(__dirname, config.twitterScreenName)
}

const storeSinceId = _ => {
  //console.log("storeSinceId", new Date().toISOString(), _)
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
  bot.startPolling();

  // Rate limit telegram messages to 1 per second to avoid throtle limits
  const telegramMsgRateLimit = 1000 // 1 second
  let telegramMsgCount = 0

  do {
    //const sinceId = await redisClient.getAsync(`${redisKeyPrefix}:sinceId`);
    const getSinceId = () => {
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
    const sinceId = getSinceId()

    const tweets = await twitter.get('statuses/user_timeline', {
      screen_name: config.twitterScreenName,
      exclude_replies: true,
      include_rts: false,
      ...(sinceId ? { since_id: sinceId } : {}),
      count: MAX_TWEET_COUNT,
    });

    if (sinceId) {
      for (const tweet of tweets.slice().reverse()) {
        // Stop relaying once the most recently relayed tweet is reached
        if (tweet.id <= +sinceId) {
          continue;
        }

        setTimeout( async () => {
          await bot.telegram.sendMessage(
            config.telegramChatId,
            [
              `@${tweet.user.screen_name}: ${tweet.text}`,
              `https://twitter.com/${tweet.user.screen_name}/status/${
                tweet.id_str
              }`,
            ].join('\n'),
            { parse_mode: 'Markdown' }
          );
  
          await storeSinceId(tweet.id_str);
        }, telegramMsgCount * telegramMsgRateLimit)
        telegramMsgCount++
      }
    } else {
      const [mostRecentTweet] = tweets;

      if (mostRecentTweet) {
        await storeSinceId(mostRecentTweet.id_str);
      }
    }
  } while (!(await delayUnlessShutdown(config.interval * 1000)));
}

main().then(process.exit);
