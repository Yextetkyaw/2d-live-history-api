const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
    // CORS Header များ သတ်မှတ်ခြင်း (ဘယ် App ကမဆို လှမ်းခေါ်လို့ရအောင်)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Content-Type', 'application/json');

    let timeData = { datetime: null, date: null, time: null };
    let marketStatus = "Closed";
    let set = "-";
    let value = "-";
    let twod = "-";

    // --- ၁။ Time API ကနေ ဒေတာဆွဲခြင်း ---
    try {
        const timeResponse = await axios.get('https://time-api-42d.vercel.app/api/time', { timeout: 5000 });
        if (timeResponse.status === 200) {
            timeData = {
                datetime: timeResponse.data.formatted_datetime,
                date: timeResponse.data.date,
                time: timeResponse.data.time
            };
        }
    } catch (error) {
        // Time API အဆင်မပြေရင် နောက်တစ်ဆင့်ကို ဆက်သွားမယ်
    }

    // --- ၂။ SET Website ကနေ ဒေတာဆွဲခြင်း ---
    try {
        const setUrl = 'https://www.set.or.th/en/home';
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };

        const response = await axios.get(setUrl, { headers, timeout: 10000 });
        const $ = cheerio.load(response.data);

        // Market Status ရှာဖွေခြင်း
        // "Market Status" ပါဝင်သော စာသားကို ရှာဖွေသည်
        $('*').each((index, element) => {
            const text = $(element).text();
            if (text.includes("Market Status")) {
                if (text.includes("Open")) marketStatus = "Open";
                if (text.includes("Closed")) marketStatus = "Closed";
                return false; // loop ကို ရပ်ရန်
            }
        });

        // Table Rows ထဲက SET ကို ရှာဖွေခြင်း
        $('tr').each((index, element) => {
            const indexTd = $(element).find('td.title-symbol');
            if (indexTd.length > 0 && indexTd.text().trim() === 'SET') {
                const tds = $(element).find('td');
                if (tds.length >= 5) {
                    set = $(tds[1]).text().trim();
                    value = $(tds[4]).text().trim();

                    // --- ၃။ 2D တွက်ချက်ခြင်း စနစ် ---
                    const setLastDigit = set.slice(-1); // set ရဲ့ နောက်ဆုံးလုံး
                    let valueBeforeDecimalDigit = "-";

                    if (value.includes('.')) {
                        const decimalIndex = value.indexOf('.');
                        valueBeforeDecimalDigit = value.charAt(decimalIndex - 1); // ဒဿမရှေ့က တစ်လုံး
                    } else {
                        valueBeforeDecimalDigit = value.slice(-1);
                    }

                    twod = setLastDigit + valueBeforeDecimalDigit;
                    return false; // loop ကို ရပ်ရန်
                }
            }
        });

    } catch (error) {
        // Website ဆွဲရက် အဆင်မပြေပါက Default (-) ပြန်မည်
    }

    // --- ၄။ ရလဒ်ကို JSON အဖြစ် ပြန်လည်ပေးပို့ခြင်း ---
    return res.status(200).json({
        status: marketStatus,
        set: set,
        value: value,
        "2d": twod,
        datetime: timeData.datetime,
        date: timeData.date,
        time: timeData.time
    });
};
