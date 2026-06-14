const axios = require('axios');
const cheerio = require('cheerio');
const { Redis } = require('@upstash/redis');

// Vercel Integration က ဆောက်ပေးလိုက်တဲ့ KV_REST_API_URL နှင့် KV_REST_API_TOKEN ကို သုံးပြီး ချိတ်ဆက်ခြင်း
const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Content-Type', 'application/json');

    let timeData = { datetime: null, date: null, time: null };
    let marketStatus = "null";
    let set = "-";
    let value = "-";
    let twod = "null";
    let dataSource = "unknown";

    let hasHistory = false;
    let historyList = [];

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };

    // ၁။ Time API ကနေ ဒေတာဆွဲခြင်း
    try {
        const timeResponse = await axios.get('https://time-api-42d.vercel.app/api/time', { timeout: 4000 });
        if (timeResponse.status === 200) {
            timeData = {
                datetime: timeResponse.data.formatted_datetime,
                date: timeResponse.data.date,
                time: timeResponse.data.time
            };
        }
    } catch (e) {}

    // ၂။ SET Home Page မှ ဒေတာဆွဲခြင်း
    let success = false;
    try {
        const response = await axios.get('https://www.set.or.th/en/home', { headers, timeout: 6000 });
        const $ = cheerio.load(response.data);

        $('div.text-black').each((i, el) => {
            const divText = $(el).text();
            if (divText.includes("Market Status")) {
                const spanText = $(el).find('span').text().trim();
                if (spanText) { marketStatus = spanText; return false; }
            }
        });

        $('tr').each((i, el) => {
            const indexTd = $(el).find('td.title-symbol');
            if (indexTd.length > 0 && indexTd.text().trim() === 'SET') {
                const tds = $(el).find('td');
                if (tds.length >= 5) {
                    set = $(tds[1]).text().trim();
                    value = $(tds[4]).text().trim();
                    dataSource = "home Page";
                    success = true;
                    return false;
                }
            }
        });
    } catch (e) { success = false; }

    // ၃။ Backup အဖြစ် Overview Page မှ ဆွဲခြင်း
    if (!success || set === "-" || value === "-") {
        try {
            const backupUrl = 'https://www.set.or.th/en/market/index/set/overview';
            const response = await axios.get(backupUrl, { headers, timeout: 6000 });
            const $ = cheerio.load(response.data);

            const setBox = $('.stock-info, .value.stock-info');
            if (setBox.length > 0) set = setBox.first().text().trim();

            const statusSpan = $('.quote-market-status span');
            if (statusSpan.length > 0) marketStatus = statusSpan.first().text().trim();

            const valueSpan = $('.quote-market-cost span');
            if (valueSpan.length > 0) value = valueSpan.text().trim();
            dataSource = "set overview";
        } catch (e) {}
    }

    // ၄။ 2D တွက်ချက်ခြင်း
    if (set !== "-") {
        const setLastDigit = set.slice(-1);
        let valueBeforeDecimalDigit = "-";

        if (value !== "-" && value.includes('.')) {
            const decimalIndex = value.indexOf('.');
            valueBeforeDecimalDigit = value.charAt(decimalIndex - 1);
        }

        if (value === "-") {
            twod = setLastDigit + "-";
        } else {
            twod = setLastDigit + valueBeforeDecimalDigit;
        }
    }
    if (marketStatus === "Closed") {
        set = "--"; value = "--"; twod = "--";
    }

    // ၅။ Redis ကိုသုံးပြီး History စီမံခန့်ခွဲခြင်း လုပ်ငန်းစဉ်
    try {
        // Redis List ထဲက နောက်ဆုံးထည့်ထားတဲ့ (အပေါ်ဆုံး) ဒေတာကို လှမ်းဖတ်တယ်
        const latestHistory = await redis.lindex('2d_history_list', 0);

        if (twod && twod !== "null" && twod !== "--" && twod !== "-") {
            let isDataChanged = true;

            if (latestHistory) {
                // ဒေတာအဟောင်း ရှိခဲ့ရင် အသစ်နဲ့ ကိုက်ညီမှု ရှိမရှိ စစ်တယ်
                isDataChanged = latestHistory["2d"] !== twod || latestHistory["set"] !== set;
            }

            if (isDataChanged) {
                // 1 စီတိုးမယ့် History ID ကို Redis မှာ Auto Increment (`incr`) လုပ်ပြီး ယူတယ်
                const nextHistoryId = await redis.incr('next_history_id');

                const newHistoryItem = {
                    history_id: nextHistoryId,
                    set: set,
                    value: value,
                    "2d": twod,
                    datetime: timeData.datetime,
                    date: timeData.date,
                    time: timeData.time
                };

                // ဒေတာအသစ်ကို List ရဲ့ အရှေ့ဆုံး (အပေါ်ဆုံး) ကို ထည့်တယ် (LPUSH)
                await redis.lpush('2d_history_list', newHistoryItem);

                // ဒေတာ အရေအတွက် အခု ၅၀ ပဲ ရှိနေစေဖို့ အောက်ကပိုနေတာတွေကို ဖြတ်ထုတ်တယ် (LTRIM)
                await redis.ltrim('2d_history_list', 0, 49);
            }
        }

        // Response ပြန်ဖို့အတွက် Redis ကနေ List တစ်ခုလုံး (0 ကနေ 49 ထိ) ကို ပြန်ခေါ်တယ်
        historyList = await redis.lrange('2d_history_list', 0, 49);
        hasHistory = historyList.length > 0;

    } catch (redisError) {
        console.error("Redis Error:", redisError);
        // Redis Error တက်ခဲ့ရင် API Crash မဖြစ်အောင် ဖမ်းထားပြီး ဒေတာအလွတ် ပြန်ပေးမယ်
        historyList = [];
        hasHistory = false;
    }

    return res.status(200).json({
        live: {
            data_source: dataSource,
            status: marketStatus,
            set: set,
            value: value,
            "2d": twod,
            datetime: timeData.datetime,
            date: timeData.date,
            time: timeData.time
        },
        hasHistory: hasHistory,
        historyList: historyList
    });
};
