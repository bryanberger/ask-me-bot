import dotenv from 'dotenv'
import Botkit from 'botkit'
import cache from 'memory-cache'
import Confluence from 'confluence-api'
import Cheerio from 'cheerio'
import natural from 'natural'
import slackify from 'slackify-html'
import express from 'express'
import os from 'os'

dotenv.config({ silent: true })

let port = process.env.PORT || 8080;
let $ = null
let faqPageId = '130672178' //'24445453'
let space = 'DT' // HR
let config = {
  username: process.env.CONFLUENCE_USER,
  password: process.env.CONFLUENCE_PASS,
  baseUrl:  process.env.CONFLUENCE_HOST
}
let confluence = new Confluence(config)
let controller = Botkit.slackbot({debug: false, stale_connection_timeout: 120000}) // re-training is taking to long?
let bot = controller.spawn({
  token: process.env.SLACK_API_TOKEN
})
// let classifier = new natural.BayesClassifier()
let classifier = new natural.LogisticRegressionClassifier()
let minConfidence = 0.8
let noConfidence = 0.5

// // start the cache
// cache.put('items', []);
// cache.put('classifier', []);

bot.startRTM((err, bot, payload) => {
  getContentAndClassifier(true).then(() => {
    console.log('init')
  })

  if (err) {
    throw new Error('Could not connect to Slack');
  }
})

let app = express()
app.get('/', function (req, res) {
  res.send('Hello World!')
})
app.listen(port, () => {
  console.log('app is running on ' + port)
})

controller.hears(['!uptime', 'who are you', 'who made you'],
'direct_message,direct_mention,mention', function(bot, message) {
  var hostname = os.hostname()
  var uptime = formatUptime(process.uptime())

  bot.reply(message, ':robot_face: I am a bot named <@' + bot.identity.name + '>.\n' +
  'I was made by :berger: :monica: :craig: :sang: during a Festivus Hackathon in 2016.\n' +
  'I have been up for `' + uptime + '` on `' + hostname + '`.')
})

controller.hears(['starboy', 'star boy'],
'direct_message,direct_mention,mention', function(bot, message) {
  bot.reply(message, 'https://youtube.com/watch?v=Ctr8PVMnLXg')
})

controller.hears(['!refresh', '!update'],
'direct_message,direct_mention,mention', function(bot, message) {
  console.log('heard', message.text)
  bot.reply(message, 'Updating my database from :confluence: Please hold...')

  getContentAndClassifier(true).then(() => {
    // getPeopleContent(true).then(() => {
      bot.reply(message, 'Update Complete!')
    // })
  })
})

controller.hears(['!channels'],
'direct_message,direct_mention,mention', function(bot, message) {
  console.log('heard', message.text)
  var list = []

  bot.api.channels.list({
    exclude_members: true,
    exclude_archived: true
  }, function(err, res) {
    if(err) {
      bot.botkit.log('error-help', err)
      bot.reply(message, err)
      return
    }

    var channels = res.channels

    channels.map(channel => {
      if(channel.is_member) {
        list.push('<#'+channel.id+'|'+channel.name+'>')
      }
    })

    bot.reply(message, '*I am currently in the follow channels:*\n' + list.join(', '))
  })
})

controller.hears(['help', 'halp'],
'direct_message,direct_mention,mention', function(bot, message) {
  var attachments = []

  cache.get('items').map(item => {
    attachments.push({
      title: item.classifier
    })
  })

  bot.reply(message, {
    text: 'You can candidly ask me about any of these subjects, and I _should_ be able to help you out:',
    attachments: attachments
  }, function(err, res) {
    if(err)
      bot.botkit.log('error-help', err)
  })
})

controller.hears('.*',
'direct_message,direct_mention,mention', function(bot, message) {
  // let texts = items.map(o => o.text);
  // var classification = classifier.classify(message.text.toLowerCase())
  var classifications = classifier.getClassifications(message.text.toLowerCase())
  var guess = classifications.reduce(toMaxValue)
  var item = cache.get('items').find(item => item.classifier === guess.label)

  console.log('heard', message.text, '| guessing', item.classifier, '|', guess.value)

  if(guess.value > minConfidence && typeof item !== 'undefined') {
    bot.reply(message, item.response)
  } else if(guess.value <= noConfidence) {
    // less than 0.5 is usually a complete guess and wrongly replies with a hmm
    return
  } else {
    // between (0.5 and 0.8)
    bot.reply(message, ':robot_face: hmm, i\'m not sure I have the answer to that one...')
  }
})


function getContentAndClassifier(force) {
  return new Promise((resolve, reject) => {
    if (!force && cache.get('classifier') && cache.get('items')) {
      classifier = natural.LogisticRegressionClassifier.restore(JSON.parse(cache.get('classifier')))
      resolve(cache.get('items'))
    }

    confluence.getCustomContentById({id: faqPageId, expanders:['body.storage', 'body.view', 'version']}, function(err, data) {
      if(!err) {
        var items = []
        $ = Cheerio.load(data.body.view.value)
      	// $ = Cheerio.load(data.results[0].body.storage.value)

        $('table tr').each(function(i, elem) {
          if(i === 0 ) { return; } // skip first ROW, the table heads (th)
          var classifierLabel   = $(this).find('td').eq(0).text()
          var phrases           = $(this).find('td').eq(1).text().toLowerCase().split(' ,')

          // Fix urls that are not absolute
          var links = $(this).find('td').eq(2).find('a')
          links.each(function(i, elem) {
            var url = $(this).attr('href')
            if (/^(\/wiki\/)/i.test(url)) {
              url = url.replace('wiki/','') // trim the wiki
              url = process.env.CONFLUENCE_HOST + url
              $(this).attr('href', url)
            }
          })

          // product a final `slackified` string
          var response = slackify($(this).find('td').eq(2).html())

          items.push({
            classifier: classifierLabel,
            phrases: phrases,
            response: response
          })

          phrases.map(phrase => {
            classifier.addDocument(phrase, classifierLabel)
          })
        })

        classifier.train()
        var oldItems = cache.get('items')
        var oldClassifier = cache.get('classifier')

        if(!force && oldClassifier && oldItems) {
          var mergedClassifier = [...oldClassifier, ...classifier]
          var mergedItems = [...oldItems, ...items]
          cache.put('items', mergedItems)
          cache.put('classifier', JSON.stringify(mergedClassifier))
        } else {
          cache.put('items', items)
          cache.put('classifier', JSON.stringify(classifier))
        }
        resolve(items)
      } else {
        reject(err)
      }
    })
  })
}

function formatUptime(uptime) {
    var unit = 'second';
    if (uptime > 60) {
        uptime = uptime / 60;
        unit = 'minute';
    }
    if (uptime > 60) {
        uptime = uptime / 60;
        unit = 'hour';
    }
    if (uptime != 1) {
        unit = unit + 's';
    }

    uptime = uptime + ' ' + unit;
    return uptime;
}

function toMaxValue(x, y) {
  return x && x.value > y.value ? x : y;
}
