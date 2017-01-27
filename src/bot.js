import dotenv from 'dotenv'
import Botkit from 'botkit'
import cache from 'memory-cache'
import Confluence from 'confluence-api'
import Cheerio from 'cheerio'
import natural from 'natural'
import slackify from 'slackify-html'

dotenv.config({ silent: true })

let $ = null
let faqPageId = '130672178' //'24445453'
let peoplePageId = '130681349'
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
let minConfidence = 0.6

bot.startRTM((err, bot, payload) => {
  // getContentAndClassifier()
  // getPeopleContent()
  getContentAndClassifier(true).then(() => {
    console.log('getContentAndClassifier')
    getPeopleContent(true).then(() => {
      console.log('getPeopleContent')
    })
  })

  if (err) {
    throw new Error('Could not connect to Slack');
  }
})

controller.hears(['who made you', 'who made u', 'who is your maker', 'who is your master'],
'direct_message,direct_mention,mention', function(bot, message) {
  bot.reply(message, ':berger: :monica: :craig: :sang:')
})

controller.hears(['starboy', 'star boy'],
'direct_message,direct_mention,mention', function(bot, message) {
  bot.reply(message, 'https://youtube.com/watch?v=Ctr8PVMnLXg')
})

controller.hears(['!refresh', '!update'],
'direct_message,direct_mention,mention', function(bot, message) {
  console.log('heard', message.text)
  bot.reply(message, 'Updating my database from :confluence: Please hold...')

  // confluence.getCustomContentById({id: peoplePageId, expanders:['body.storage', 'body.view', 'version']}, function(err, data) {
  //   console.log(err, data)
  // });

  getContentAndClassifier(true).then(() => {
    console.log('getContentAndClassifier')
    getPeopleContent(true).then(() => {
      console.log('getPeopleContent')
      bot.reply(message, 'Update Complete!')
    })
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
    if(item.type === 'FAQ') {
      bot.reply(message, item.response)
    } else if(item.type === 'Person') {

      var attachments = []

      attachments.push(
        {
          title: item.name,
          author_name: item.jobTitle,
          image_url: item.photo
        },
        {
          text: item.description,
          unfurl_links: true,
          unfurl_media: true,
          fallback: ''
        },
        {
          title: 'Hobbies',
          text: item.hobbies.join(', '),
          color: '#0D8390'
        },
        {
          title: 'Patronus',
          text: item.spiritAnimal,
          color: '#1ECAC7'
        }
      )

      bot.reply(message, {
        attachments: attachments
      })
      // bot.reply(message, item.description + '_-' + item.name + '_')
    }
  } else {
    bot.reply(message, 'hmm...not sure I have the answer, feel free to reach out to hrteam@ga.co')
  }
})


function getPeopleContent(force) {
  return new Promise((resolve, reject) => {

    if (!force && cache.get('classifier') && cache.get('items')) {
      classifier = natural.LogisticRegressionClassifier.restore(JSON.parse(cache.get('classifier')))
      resolve(cache.get('items'))
    }

    confluence.getCustomContentById({id: peoplePageId, expanders:['body.storage', 'body.view', 'version']}, function(err, data) {
      if(!err) {
        var items = []

        $ = Cheerio.load(data.body.view.value)

        $('table tr').each(function(i, elem) {
          if(i === 0 ) { return; } // skip first ROW, the table heads (th)
          var name              = $(this).find('td').eq(0).text() // name
          var classifierLabel   = name.replace('é','e')
          var phrases           = $(this).find('td').eq(1).text().toLowerCase().split(' ,')
          var jobTitle          = $(this).find('td').eq(2).text()
          var description       = slackify($(this).find('td').eq(3).html())
          var hobbies           = slackify($(this).find('td').eq(4).html()).split(' ,')
          var spiritAnimal      = $(this).find('td').eq(5).text().toLowerCase()
          // var photo             = $(this).find('td').eq(6).find('img').attr('src')
          var photo             = photoLookup(classifierLabel)

          // Fix urls that are not absolute
          // var links = $(this).find('td').eq(2).find('a')
          // links.each(function(i, elem) {
          //   var url = $(this).attr('href')
          //   if (/^(\/wiki\/)/i.test(url)) {
          //     url = url.replace('wiki/','') // trim the wiki
          //     url = process.env.CONFLUENCE_HOST + url
          //     $(this).attr('href', url)
          //   }
          // })

          // product a final `slackified` string
          // var response = slackify($(this).find('td').eq(2).html())
console.log(description)
          var item = {
            type: 'Person',
            classifier: classifierLabel,
            name: name,
            phrases: phrases,
            jobTitle: jobTitle,
            description: description,
            hobbies: hobbies,
            spiritAnimal: spiritAnimal,
            photo: photo
          }

          items.push(item)

          classifier.addDocument(item.name, classifierLabel)
          classifier.addDocument(item.jobTitle, classifierLabel)
          classifier.addDocument(item.description, classifierLabel)
          classifier.addDocument(item.spiritAnimal, classifierLabel)
          hobbies.map(hobby => {
            classifier.addDocument(hobby, classifierLabel)
          })
          phrases.map(phrase => {
            classifier.addDocument(phrase, classifierLabel)
          })
        })

        classifier.train()

        var oldItems = cache.get('items')
        var oldClassifier = cache.get('classifier')

        if(oldClassifier && oldItems) {
          var mergedClassifier = [...oldClassifier, ...classifier]
          var mergedItems = [...oldItems, ...items]
          cache.put('items', mergedItems, 3600000)
          cache.put('classifier', JSON.stringify(mergedClassifier), 3600000)
        } else {
          cache.put('items', items, 3600000)
          cache.put('classifier', JSON.stringify(classifier), 3600000)
        }

        resolve(items)
      } else {
        reject(err)
      }
    })
  })
}







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
            type: 'FAQ',
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
          cache.put('items', mergedItems, 3600000)
          cache.put('classifier', JSON.stringify(mergedClassifier), 3600000)
        } else {
          cache.put('items', items, 3600000)
          cache.put('classifier', JSON.stringify(classifier), 3600000)
        }
        resolve(items)
      } else {
        reject(err)
      }
    })
  })
}

function toMaxValue(x, y) {
  return x && x.value > y.value ? x : y;
}

// confluence.getAttachments(space, '130681349', function(err, data) {
//
//   data.results.map(function(o){
//     console.log(o.container, o.metadata)
//   })
// })


function photoLookup(classifierLabel) {
  var people = {
    'Nick Siradas':         'https://www.dropbox.com/s/ndchcneg8i7cvst/Nick%20Siradas.jpg?raw=1',
    'Becca Wilson':         'https://www.dropbox.com/s/0o5okskg1xmv7to/Becca%20Wilson.jpg?raw=1',
    'Jay Nappy':            'https://www.dropbox.com/s/gg9bnlptfp50mn4/Jay%20Nappy.png?raw=1',
    'Claire Collery':       'https://www.dropbox.com/s/sg51nrw1cbyoead/Claire%20Collery.png?raw=1',
    'Isabel Rittenberg':    'https://www.dropbox.com/s/x0qcvbb0a6yxcw2/Isabel%20Rittenberg.jpg?raw=1',
    'Brianna Plaza':        'https://www.dropbox.com/s/727vnp4x84uhma6/Brianna%20Plaza.jpg?raw=1',
    'Anand Chopra-McGowan': 'https://www.dropbox.com/s/y2go3syy9heajlo/Anand%20Chopra-McGowan.jpg?raw=1',
    'Laura Consoli':        'https://www.dropbox.com/s/s9l8rssryitl3o1/Laura%20Consoli.jpg?raw=1',
    'Ariana Dugan':         'https://www.dropbox.com/s/zo8mu7809azp0zn/Ariana%20Dugan.png?raw=1',
    'Monica Singh':         'https://www.dropbox.com/s/pqxrzqjchfvooko/Monica%20Singh.jpg?raw=1',
    'Craig Samoviski':      'https://www.dropbox.com/s/xn72hfuf4wynbf8/Craig%20Samoviski.jpg?raw=1',
    'Bryan Berger':         'https://www.dropbox.com/s/oppmibxn67hf7p9/Bryan%20Berger.png?raw=1',
    'Sang Zhang':           'https://www.dropbox.com/s/airhcjlnd9kklgk/Sang%20Zhang.jpg?raw=1',
    'Karey Kyle':           'https://www.dropbox.com/s/43izvr96sftq6w5/Karey%20Kyle.png?raw=1',
    'Tim Cheadle':          'https://www.dropbox.com/s/tgx9g4zrz5728wm/Tim%20Cheadle.jpg?raw=1',
    'Sydney Nychuk':        'https://www.dropbox.com/s/yfzcavk0wiie4ht/Sydney%20Nychuk.png?raw=1',
    'Maya Jimenez':         'https://www.dropbox.com/s/10h8xzsd9996olb/Maya%20Jim%C3%A9nez.jpg?raw=1',
    'Hari Mohanraj':        'https://www.dropbox.com/s/1hjx2qo8zof98ds/Hari%20Mohanraj.jpg?raw=1',
  }

  return people[classifierLabel] || null
}


// classifier.events.on('trainedWithDocument', function (obj) {
//   var raw = JSON.stringify(classifier);
//   // cache training classifier for 1 hr
//   cache.put('classifier', raw, 3600000);
//
//   // deserialize
//   // var restoredClassifier = natural.BayesClassifier.restore(JSON.parse(raw));
// })


// confluence.getCustomContentById({id: faqPageId, expanders:['body.storage', 'body.view', 'version']}, function(err, data) {
//   console.log(data.body.view);
// })

// confluence.getContentByPageTitle(space, 'The People of GA', function(err, data) {
//   console.log(data)
// })
// confluence.getContentByPageTitle(space', 'Frequently Asked Questions', function(err, data) {
  // if(data.results.length > 0) {
