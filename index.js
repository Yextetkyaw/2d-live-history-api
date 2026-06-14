const axios = require('axios');
const cheerio = require('cheerio');
const { Redis } = require('@upstash/redis');

const redis = Redis.fromEnv(); 

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
    
    let noonResult = "--";
    let eveningResult = "--";

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
    } catch (e) {
        console.error("Time API Error:", e.message);
    }

    const todayDate = timeData.date; // ယနေ့ရက်စွဲ (ဥပမာ - "2026-06-14")

    // ၂။ နည်းလမ်း (၁) - မူလ Home Page ကနေ Market Status ကို အရင်ဆွဲခြင်း (Reset Logic အတွက် လိုအပ်လို့ပါ)
    let success = false;
    try {
        const response = await axios.get('https://www.set.or.th/en/home', { headers, timeout: 6000 });
        const $ = cheerio.load(response.data);

        $('div.text-black').each((i, el) => {
            const divText = $(el).text();
            if (divText.includes("Market Status")) {
                const spanText = $(el).find('span').text().trim();
                if (spanText) {
                    marketStatus = spanText;
                    return false;
                }
            }
        });

        $('tr').each((i, el) => {
            const indexTd = $(el).find('td.title-symbol');
            if (indexTd.length > 0 && indexTd.text().trim() === 'SET') {
                const tds = $(el).find('td');
                if (tds.length >= 5) {
                    set = $(tds[1]).text().trim();
                    value = $(tds[4]).text().trim();
                    success = true;
                    dataSource = "home page";
                    return false;
                }
            }
        });
    } catch (e) {
        success = false;
    }

    // နည်းလမ်း (၂) - Backup အနေနဲ့ Overview Page ကနေ Status ဆွဲခြင်း
    if (!success || set === "-" || value === "-") {
        try {
            const backupUrl = 'https://www.set.or.th/en/market/index/set/overview';
            const response = await axios.get(backupUrl, { headers, timeout: 6000 });
            const $ = cheerio.load(response.data);

            const setBox = $('.stock-info, .value.stock-info');
            if (setBox.length > 0) { set = setBox.first().text().trim(); }

            const statusSpan = $('.quote-market-status span');
            if (statusSpan.length > 0) { marketStatus = statusSpan.first().text().trim(); }

            const valueSpan = $('.quote-market-cost span');
            if (valueSpan.length > 0) { value = valueSpan.text().trim(); }

            if (set !== "-" && value !== "-") { dataSource = "set overview"; }
        } catch (e) {
            dataSource = "failed";
        }
    }

    // ၃။ Database ဒေတာ စစ်ဆေးခြင်းနှင့် အလိုအလျောက် Data Reset ချခြင်း Logic
    if (todayDate) {
        try {
            const savedData = await redis.get(`result:${todayDate}`);
            
            // မနက် ၉ နာရီထိုးပြီး ဈေးကွက်ပွင့်သွားပြီ (Closed မဟုတ်တော့ဘူး) ဆိုလျှင် ဒေတာဟောင်းကို Reset ချမည်
            if (marketStatus !== "Closed" && marketStatus !== "null") {
                // Database ထဲမှာ ဒေတာဟောင်း ရှိနေခဲ့ရင် ဖျက်ပစ်လိုက်ပါမယ်
                if (savedData) {
                    await redis.del(`result:${todayDate}`);
                }
                noonResult = "--";
                eveningResult = "--";
            } else {
                // ဈေးကွက်မပွင့်သေးဘူး (Closed ဖြစ်နေတုန်း) ဆိုရင်တော့ Database ထဲက ဒေတာအတိုင်း ပြပေးထားမယ်
                if (savedData) {
                    noonResult = savedData.noon_result || "--";
                    eveningResult = savedData.evening_result || "--";
                }
            }
        } catch (e) {
            console.error("Upstash Redis Read/Reset Error:", e.message);
        }
    }

    // ၄။ 2D History API ကနေ ဒေတာသစ် တက်မတက် စစ်ဆေးပြီး သိမ်းဆည်းခြင်း
    // (Market Status က Open ဖြစ်နေမှသာ ဒေတာသစ်ကို စစ်ပြီး သိမ်းဖို့ လိုအပ်ပါတယ်)
    if (marketStatus !== "Closed" && marketStatus !== "null") {
        try {
            const historyResponse = await axios.get('https://2d-history-api-six.vercel.app/', { timeout: 4000 });
            if (historyResponse.status === 200 && historyResponse.data) {
                
                const apiNoonData = historyResponse.data.noon_record_data;
                const apiEveningData = historyResponse.data.evening_record_data;

                let needToUpdate = false;

                // Noon ဒေတာအသစ် တက်လာရင် သိမ်းမယ်
                if (noonResult === "--" && apiNoonData !== null && apiNoonData !== undefined) {
                    noonResult = apiNoonData;
                    needToUpdate = true;
                }

                // Evening ဒေတာအသစ် တက်လာရင် သိမ်းမယ်
                if (eveningResult === "--" && apiEveningData !== null && apiEveningData !== undefined) {
                    eveningResult = apiEveningData;
                    needToUpdate = true;
                }

                if (needToUpdate && todayDate) {
                    await redis.set(`result:${todayDate}`, {
                        noon_result: noonResult,
                        evening_result: eveningResult
                    });
                }
            }
        } catch (e) {
            console.error("API Fetch or Upstash Write Error:", e.message);
        }
    }

    // ၅။ 2D ဂဏန်း တွက်ချက်ခြင်း
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

    // Market Status က Closed ဖြစ်နေလျှင် set,value,2d ဒေတာများကို -- သို့ပြောင်းလဲခြင်း
    if (marketStatus === "Closed") {
        set = "--";
        value = "--";
        twod = "--";
    }

    // ရလဒ်ကို ပေးပို့ခြင်း
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
        noon_result: noonResult,
        evening_result: eveningResult
    });
};
