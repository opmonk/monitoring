'use strict';

const mysql = require('mysql');
const request = require('request');
var sprintf = require("sprintf-js").sprintf;
var moment = require('moment-timezone');
moment().tz("America/Los_Angeles").format();
var querystring = require('querystring');

// const db = mysql.createConnection({
//   host: process.env.DB_HOST,
//   database: process.env.DB_DATABASE,
//   user: process.env.DB_USERNAME,
//   password: process.env.DB_PASSWORD
// });

const channel = process.env.SLACK_CHANNEL || 'ben-test';
const numOfCycles = 4;


const createConnection = () => {
  return mysql.createConnection({
          host: process.env.DB_HOST,
          database: process.env.DB_DATABASE,
          user: process.env.DB_USERNAME,
          password: process.env.DB_PASSWORD
        });
};

/**
 * Calculates useful crawler summaries, such as percent finished and unsuccessful
 * @params {object} DB results object that contains crawling status with their counts
 * @returns {object} summary object
 */
const calculateSummary = (results) => {
  let total = 0;
  let unsuccessful = 0; // failed + cancelled
  let outstanding = 0; // crawling + scheduled

  results.forEach(result => {
    const count = result["Total Count"];
    const status = result["status"];

    if (status == 'cancelled' || status == 'failure') unsuccessful += count;
    else if (status == 'scheduled' || status == 'crawling') outstanding += count;
    total += count;
  });

  const finishedPercentage = ((total - outstanding) / total * 100).toFixed(2);
  const unsuccessfulPercentage = (unsuccessful / total * 100).toFixed(2);
  return {
    finishedPercentage,
    unsuccessfulPercentage
  };
};

/**
 * Generates & formats Slack crawler alert message
 * @params {object} DB results data along with summary data (and start/end info)
 * @returns {string} slack alert text
 */
const formatCrawlerAlert = (results) => {
  const {
    summary,
    summary: {
      startTime,
      endTime,
      unsuccessfulPercentage,
      finishedPercentage
    }
  } = results;


  const all_summary = results.data.filter(i => {return i.rpi =='both' && i['crawler_id'] == 'all_crawler'});
  const amazon_summary = results.data.filter(i => {return i.rpi =='both' && i['crawler_id'] == 6});
  const rpi_summary = results.data.filter(i => {return i.rpi =='rpi'});

  const [today, startHour] = startTime.split(" ");
  const endHour = endTime.split(" ")[1];

  let title = `*Crawler Alert*: (${startTime} to ${endTime}) \n`;
  let text = "";

  text += `All\n`;
  text += `--------------------\n`;
  all_summary.forEach(item => {
    text += sprintf('%-10s%10f\n', item["status"], item["count"]);
  });

  text += `\n`;
  text += `Amazon\n`;
  text += `--------------------\n`;
  amazon_summary.forEach(item => {
    text += sprintf('%-10s%10f\n', item["status"], item["count"]);
  });

  text += `\n`;
  text += `RPI\n`;
  text += `--------------------\n`;
  rpi_summary.forEach(item => {
    text += sprintf('%-10s%10f\n', item["status"], item["count"]);
  });

  // title += `:white_check_mark:  *Finished*: ${summary.finishedPercentage}%\n`;
  // title += `:x:  *Unsuccessful*: ${summary.unsuccessfulPercentage}%\n`;
  return title + "```" + text + "```";
};

/**
 * Generates Slack alert
 * @params {void}
 * @returns {string} returns string body of slack alert text. Also posts to slack.
 */
module.exports.generateSlackAlert = async event => {
  const db = createConnection();
  const today = moment().date();
  const isOddDay = today % 2 == 1;
  let startTime;
  let endTime;
  endTime = moment().format("YYYY-MM-DD hh:mm:ss");
  startTime = moment().subtract(1, "days").format("YYYY-MM-DD hh:mm:ss");
  console.log("StartTime:", startTime);
  console.log("EndTime:", endTime);

  
  // if (isOddDay && today != 31) {
  //   startTime = moment().subtract(1, "days").hour(2).minute(0).second(0).format("YYYY-MM-DD hh:mm:ss");
  //   endTime = moment().subtract(1, "days").hour(3).minute(0).second(0).format("YYYY-MM-DD hh:mm:ss");
  // } else {
  //   startTime = moment().hour(2).minute(0).second(0).format("YYYY-MM-DD hh:mm:ss");
  //   endTime = moment().hour(3).minute(0).second(0).format("YYYY-MM-DD hh:mm:ss");
  // }

  // const sql = `
  //   select status, count(*) as "Total Count" from crawls where created_at > ? and created_at <= ? group by status
  // `;

  const sql = `
  select IFNULL(rpi, 'both') as rpi, status, crawler_id, count from  (select IF(run_token like '2020%', 'rpi', 'regular') as rpi, IFNULL(status, 'all_status') as status, IFNULL(crawler_id, 'all_crawler') as crawler_id, count(*) as "count" from crawls where created_at > '2020-03-23 09:54:34' and created_at <= '2020-03-24 09:54:34' group by status, crawler_id, rpi with rollup) as temp;
  `;

  const promise = new Promise(function(resolve, reject) {
    db.query(sql, [startTime, endTime], async function(error, results, fields) {
      db.end();

      
      const summary = {startTime,endTime};
      // const summary = {
      //   all: Object.assign({startTime,endTime},all_summary),
      //   amazon: Object.assign({startTime,endTime},amazon_summary)
      // }
      //const summary = Object.assign({startTime,endTime},calculateSummary(results));

      let text = formatCrawlerAlert({
        data: results,
        summary
      });
      console.log("Slack Text:", text);

      // let atext = formatCrawlerAlert({
      //   data: amazon_summary,
      //   summary
      // }, 'Amazon');
      // console.log("Slack aText:", atext);

      request({
        method: 'POST',
        url: 'https://hooks.slack.com/services/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',
        json: true,
        body: {
          'username': 'IPSHARK-BOT',
          'text': text,
          'channel': channel,
          color: "#2eb886"
        }
      }, function(err, res, body) {
        if (err) console.log(err);
        resolve({
          statusCode: 200,
          body: text
        })
      });
    }).on('error', (e) => {
      reject(Error(e));
    });
  })

  return promise;
};


/**
 * Generates & formats Slack crawler alert message
 * @params {object} DB results data along with summary data (and start/end info)
 * @returns {string} slack alert text
 */
const formatCrawlerTrendAlert = (results, crawler_id) => {
  const {
    summary,
    summary: {
      startTime,
      endTime,
      unsuccessfulPercentage,
      finishedPercentage
    }
  } = results;


  const all_summary = results.data.filter(i => {return  i['crawler_id'] == 'all_crawler' && i['day'] != 'all_day'});
  const amazon_summary = results.data.filter(i => {return i['crawler_id'] == 6 && i['day'] != 'all_day'});
  // const rpi_summary = results.data.filter(i => {return i.rpi =='rpi'});

  const [today, startHour] = startTime.split(" ");
  const endHour = endTime.split(" ")[1];

  let title = `*Crawler Trend Alert*: \n`;
  let text = "";

  text += `All\n`;
  text += `--------------------\n`;
  all_summary.forEach(item => {
    text += sprintf('%-10s%10f\n', item["day"], item["daily_submission_count"]);
  });

  text += `\n`;
  text += `Amazon\n`;
  text += `--------------------\n`;
  amazon_summary.forEach(item => {
    text += sprintf('%-10s%10f\n', item["day"], item["daily_submission_count"]);
  });

  // text += `\n`;
  // text += `RPI\n`;
  // text += `--------------------\n`;
  // rpi_summary.forEach(item => {
  //   text += sprintf('%-10s%10f\n', item["status"], item["count"]);
  // });

  // title += `:white_check_mark:  *Finished*: ${summary.finishedPercentage}%\n`;
  // title += `:x:  *Unsuccessful*: ${summary.unsuccessfulPercentage}%\n`;
  return title + "```" + text + "```";
};

/**
 * Generates Slack alert
 * @params {void}
 * @returns {string} returns string body of slack alert text. Also posts to slack.
 */
module.exports.generateSlackTrendAlert = async event => {
  const db = createConnection();
  const today = moment().date();

  let startTime;
  let endTime;
  endTime = moment().format("YYYY-MM-DD hh:mm:ss");
  startTime = moment().subtract(1, "days").format("YYYY-MM-DD hh:mm:ss");

  const sql = `
select crawler_id, IFNULL(day, 'all_day') as day, daily_submission_count from  (select IFNULL(crawler_id, 'all_crawler') as crawler_id, DATE(created_at) as day, sum(submission_count) as daily_submission_count from crawls where created_at > DATE_SUB(CURDATE(), INTERVAL 10 DAY) group by day, crawler_id with rollup) as temp;`

  const promise = new Promise(function(resolve, reject) {
    db.query(sql, [startTime, endTime], async function(error, results, fields) {
      db.end();
      
      const summary = {startTime,endTime};

      let text = formatCrawlerTrendAlert({
        data: results,
        summary
      });

      request({
        method: 'POST',
        url: 'https://hooks.slack.com/services/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',
        json: true,
        body: {
          'username': 'IPSHARK-BOT',
          'text': text,
          'channel': channel,
          color: "#2eb886"
        }
      }, function(err, res, body) {
        if (err) console.log(err);
        resolve({
          statusCode: 200,
          body: text
        })
      });
    }).on('error', (e) => {
      reject(Error(e));
    });
  })

  return promise;
};

const cleanString = (str) => {
  return str.replace(/,/g, '');
};


// const formatFailedCrawlsReport = (results) => {
//   let text = `Platform,Client,Asset,Keyword,Comment\n`;
//   results.forEach(item => {
//     const comment = `Failed on ${item.count} out of ${numOfCycles} cycles`;
//     const platform = cleanString(item.Platform);
//     const client = cleanString(item.Client);
//     const asset = cleanString(item.Asset);
//     const keyword = cleanString(item.Keyword);
//     text += `${platform},${client},${asset},${keyword},${comment}\n`
//   });
//   return text;
// }

/**
 * Generates Failed Crawls Report
 * @params {void}
 * @returns {string} returns string body of slack alert text. Also posts to slack.
 */
// module.exports.generateFailedCrawlsReport = async event => {
//   const sql = `
//     SELECT count(*) as count, 
//            crawlers.platform as Platform,
//            accounts.name as Client,
//            assets.name as Asset, 
//            keywords.keyword as Keyword
//     FROM (SELECT * 
//           FROM crawls 
//           WHERE status='failure' and created_at > ? and 
//                 HOUR(created_at) >= 1 and HOUR(created_at) <= 2 and 
//                 MOD(DAY(created_at),2)=0 
//                 ORDER BY id desc) temp 
//     JOIN crawlers on(temp.crawler_id=crawlers.id) 
//     JOIN assets on(assets.id=temp.asset_id) 
//     JOIN keywords on(keywords.id=temp.keyword_id) 
//     JOIN accounts on(accounts.id=assets.account_id) 
//     GROUP by Platform, Client, Asset, Keyword 
//     ORDER by count desc;
//   `;

//   const promise = new Promise(function(resolve, reject) {
//     db.query(sql, [], async function(error, results, fields) {
//       console.log(JSON.stringify(results));
//       resolve({})
//       const text = formatFailedCrawlsReport(results);
//       console.log(text);
//       const form = {
//         token: "xoxb-10372493554-767391259681-hoxTs6FeLrNu3iobY6Umz89J",
//         channels: "ben-test",
//         filetype: "csv",
//         title: "Failed Crawls",
//         content: text
//       };
//       const formData = querystring.stringify(form);

//       const options = {
//         headers: {
//           'Content-Type': 'application/x-www-form-urlencoded',
//           'Content-Length': formData.length
//         },
//         url: 'https://slack.com/api/files.upload',
//         method: 'POST',
//         body: formData
//       };
//       request(options, function(err, res, body) {
//         if (err) console.log("Err:", err);
//         console.log(body)
//         resolve({
//           statusCode: 200,
//           body: text
//         })
//       });
//     }).on('error', (e) => {
//       reject(Error(e));
//     });
//   })

//   return promise;
// };

/**
 * Generates Failed Crawls Report
 * @params {void}
 * @returns {string} returns string body of slack alert text. Also posts to slack.
 */
// module.exports.handleSlackAction = async event => {

//   // return {
//   //   body: JSON.stringify(event),
//   //   statusCode: 200
//   // }
//   // const sql = `
//   //   select * from crawls limit 10
//   // `;

//   const sql = `
//     select status, count(*) as "Total Count" from crawls where created_at > '2019-11-04 01:00:00' and created_at <= '2019-11-04 02:00:00' group by status
//   `;
//   const promise = new Promise(function(resolve, reject) {
//     db.query(sql, [], async function(error, results, fields) {
//       console.log("err",error)
//       return resolve({statusCode: 200, body: 'hi'});

//       request({
//         method: 'POST',
//         url: 'https://hooks.slack.com/services/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',
//         json: true,
//         body: {
//           'username': 'IPSHARK-BOT',
//           'text': text,
//           'channel': channel,
//           color: "#2eb886"
//         }
//       }, function(err, res, body) {
//         if (err) console.log(err);
//         resolve({
//           statusCode: 200,
//           body: text
//         })
//       });
//     }).on('error', (e) => {
//       reject(Error(e));
//     });
//   })

//   return promise;
// };



/**
 * Generates Pending Listings to be Closed Report
 * @params {void}
 * @returns {string} returns string body of slack alert text. Also posts to slack.
 */
module.exports.generatePendingClosedSummary = async event => {
  const db = createConnection();
  const sql = `
    SELECT count(*) AS count FROM discoveries 
    WHERE cached_status='pending' 
      AND last_seen_at < DATE_SUB(NOW(), INTERVAL 7 DAY);
  `;

  const pendingResubmitSql = `
    SELECT count(*) AS count FROM discoveries 
    WHERE cached_status='pending' 
      AND (last_seen_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            AND updated_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
          );
  `;
  const promise = new Promise(function(resolve, reject) {
    db.query(sql, [], async function(error, results, fields) {
      db.end();
      const count = results[0]["count"];
      const text = `There are ${count} pending listings to be closed`;

      request({
        method: 'POST',
        url: 'https://hooks.slack.com/services/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',
        json: true,
        body: {
          'username': 'IPSHARK-BOT',
          'text': text,
          'channel': channel,
          color: "#2eb886"
        }
      }, function(err, res, body) {
        if (err) console.log(err);
        resolve({
          statusCode: 200,
          body: text
        })
      });
    }).on('error', (e) => {
      reject(Error(e));
    });
  })

  return promise;
};

/**
 * Generates Pending Listings to be Resubmit Report
 * @params {void}
 * @returns {string} returns string body of slack alert text. Also posts to slack.
 */
module.exports.generatePendingResubmitSummary = async event => {
  const db = createConnection();
  const sql = `
    SELECT count(*) AS count FROM discoveries 
    WHERE cached_status='pending' 
      AND (last_seen_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            AND updated_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
          );
  `;
  const promise = new Promise(function(resolve, reject) {
    db.query(sql, [], async function(error, results, fields) {
      db.end();
      const count = results[0]["count"];
      const text = `There are ${count} pending listings to be resubmit`;

      request({
        method: 'POST',
        url: 'https://hooks.slack.com/services/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',
        json: true,
        body: {
          'username': 'IPSHARK-BOT',
          'text': text,
          'channel': channel,
          color: "#2eb886"
        }
      }, function(err, res, body) {
        if (err) console.log(err);
        resolve({
          statusCode: 200,
          body: text
        })
      });
    }).on('error', (e) => {
      reject(Error(e));
    });
  })

  return promise;
};



module.exports.generateCrawlMetadata = async event => {

  const db = createConnection();
  const sql = `select schedules.crawler_id as crawler_id, keywords.keyword as keyword, assets.id as asset_id, assets.account_id as account_id, keywords.id as keyword_id, ps.start_url as start_url from schedules join keywords on(schedules.keyword_id=keywords.id) join assets on (keywords.asset_id=assets.id) join parsehub_settings ps on (ps.crawler_id=schedules.crawler_id and ps.keyword_id=schedules.keyword_id) where schedules.crawler_id=11;`;

  const promise = new Promise(function(resolve, reject) {
    db.query(sql, async function(error, results, fields) {
      db.end();
      //if (error) throw error;

      resolve({statusCode: 200, body: JSON.stringify(results)});
    }).on('error', (e) => {
      reject(Error(e));
    });
  });

  return promise;
};


module.exports.createCrawl = async event => {

  const db = createConnection();

  const body = event.body;

  if (!body || !body.crawlerId || !body.assetId || !body.keywordId || !body.runToken) throw new Error ('Missing crawlerId, assetId, keywordId or runToken');

  const { 
    runToken,
    crawlerId, 
    assetId, 
    keywordId, 
    mode='light', 
    parsehubAccountId=1, 
    startingUrl='NULL', 
    status='NULL', 
    crawlStartedAt=new Date().toISOString().slice(0, 19).replace('T', ' '),
    crawlEndedAt=new Date().toISOString().slice(0, 19).replace('T', ' '),
    userId='NULL'
  } = body;


  const sql = `INSERT INTO crawls 
                (run_token, crawler_id, asset_id, keyword_id, mode, parsehub_account_id, starting_url, status, crawl_started_at, crawl_ended_at, user_id) 
                VALUES ('${runToken}', ${crawlerId}, ${assetId}, ${keywordId}, '${mode}', ${parsehubAccountId}, '${startingUrl}', '${status}', '${crawlStartedAt}', '${crawlEndedAt}', ${userId});`

                console.log(sql)
  const promise = new Promise(function(resolve, reject) {

    //resolve({statusCode: 200, body: JSON.stringify({ crawlerId, assetId, keywordId, mode, parsehub_account_id })})
    db.query(sql, async function(error, results, fields) {
      db.end();
      if (error) throw error;

      resolve({statusCode: 200, body: JSON.stringify(results)});
    }).on('error', (e) => {
      reject(Error(e));
    });
  });

  return promise;
};