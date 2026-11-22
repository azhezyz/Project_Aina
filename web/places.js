(() => {
  const {en} = window.atlasLocale;
  const areaNames = { "东山": "Higashiyama", "清水": "Kiyomizu", "祇园": "Gion",
    "东山 · 八坂通": "Higashiyama · Yasaka-dori", "东山 · 高台寺": "Higashiyama · Kodai-ji" };
  const kinds = { "神社": "Shrine", "街区": "Street", "寺院": "Temple", "咖啡馆": "Café", "公园": "Park" };
  const englishDetails = {
    yasaka: {
      hours: "Shrine grounds open 24 hours. Office open 09:00–17:00.",
      address: "625 Gionmachi Kitagawa, Higashiyama, Kyoto",
      note: "Enter the shrine from Gion, then head south through the lanes of Higashiyama."
    },
    ninen: { note: "Take your time on the stone steps. Look between the wooden townhouses for glimpses of the Higashiyama hills." },
    kiyomizu: {
      hours: "Usually 06:00–18:00, until 18:30 in July and August. Special evening visits have separate hours.",
      note: "The last stop on the walk. Leave time for the hillside steps and a look around the temple."
    },
    arabica: {
      short: "% Arabica", address: "87-5 Hoshinocho, Higashiyama, Kyoto",
      note: "Pick up a coffee near Yasaka-dori before continuing toward Ninenzaka."
    },
    coffee: {
      short: "Maeda Coffee", hours: "07:00–16:00. Closed Mondays.",
      address: "415 Shimokawara-cho, Shimokawara-dori, south of Yasaka Torii, Higashiyama, Kyoto",
      note: "A traditional coffee shop near Kodai-ji where you can sit down for a break."
    },
    kennin: {
      hours: "10:00–17:00. Last entry at 16:30.",
      address: "Komatsucho, Yamato-oji-dori, south of Shijo, Higashiyama, Kyoto",
      note: "Turn off Hanamikoji and into the temple grounds for an extra stop in Gion."
    },
    kodaiji: {
      hours: "Usually 09:00–17:30. Last entry at 17:00. Special evening visits have separate hours.",
      note: "Follow the lane along the stone wall to Kodai-ji. Ninenzaka is nearby."
    },
    maruyama: {
      address: "Maruyamacho, Higashiyama, Kyoto",
      note: "Just east of Yasaka Shrine, this park makes an easy place to pause along the way."
    },
    sannen: { note: "This stone staircase connects Ninenzaka with the Kiyomizu area." },
    gion: { note: "Follow Gion’s main street south to reach Kennin-ji." }
  };
  const places = [
    { id: "yasaka", googlePlaceId: "ChIJqewQoHkIAWAR6RokWp3Iesc", name: "八坂神社", local: "八坂神社", en: "Yasaka Shrine", kind: "神社", icon: "shrine", area: "祇园", lat: 35.00364, lng: 135.77852, hours: "境内全天可参拜，社务所 09:00–17:00", address: "京都市东山区祇园町北侧 625", url: "https://www.yasaka-jinja.or.jp/", source: "https://www.yasaka-jinja.or.jp/access/", note: "从祇园一侧进神社，再沿东山的小路向南走。" },
    { id: "ninen", googlePlaceId: "ChIJlwyrGNAIAWARNb5hUHdZruY", name: "二年坂", local: "二寧坂", en: "Ninenzaka", kind: "街区", icon: "street", area: "东山", lat: 34.99856, lng: 135.78071, hours: "", url: "https://www.kyoto-kankou.or.jp/info_search/125", note: "沿石阶慢慢走，两侧的町家之间能望见东山。" },
    { id: "kiyomizu", googlePlaceId: "ChIJB_vchdMIAWARujTEUIZlr2I", name: "清水寺", local: "清水寺", en: "Kiyomizu-dera", kind: "寺院", icon: "temple", area: "清水", lat: 34.99486, lng: 135.78505, hours: "通常 06:00–18:00，7–8 月至 18:30；夜间特别参拜另计", url: "https://www.kiyomizudera.or.jp/", source: "https://www.kiyomizudera.or.jp/news/open-hour.php", note: "路线的最后一站。山坡一带有台阶，建议预留停留时间。" },
    { id: "arabica", googlePlaceId: "ChIJnW0DdsUIAWAROy9GuxW9QVI", name: "% Arabica 京都东山", short: "% Arabica", local: "アラビカ京都 東山", en: "% Arabica Kyoto Higashiyama", kind: "咖啡馆", icon: "coffee", area: "东山 · 八坂通", lat: 34.99824, lng: 135.77842, hours: "", address: "京都市东山区星野町 87-5", url: "https://arabica.com/en/location/arabica-kyoto-higashiyama/", source: "https://arabica.com/en/location/arabica-kyoto-higashiyama/", note: "八坂通附近的咖啡站，适合外带一杯，再继续往二年坂走。" },
    { id: "coffee", googlePlaceId: "ChIJB1aZxO0HAWARVxKOd1kp_jk", name: "前田珈琲 高台寺店", short: "前田珈琲", local: "前田珈琲 高台寺店", en: "Maeda Coffee Kodaiji", kind: "咖啡馆", icon: "coffee", area: "东山 · 高台寺", lat: 35.00002, lng: 135.77963, hours: "07:00–16:00，周一休息（日文门店页）", address: "京都市东山区下河原通八坂鸟居前下南町 415", url: "https://www.maedacoffee.com/shopinfo/koudaiji/", source: "https://www.maedacoffee.com/shopinfo/koudaiji/", note: "高台寺附近的喫茶店，适合在散步途中坐下来休息。" },
    { id: "kennin", googlePlaceId: "ChIJJ3srJMEIAWARUrvFhhmPYH4", name: "建仁寺", local: "建仁寺", en: "Kennin-ji", kind: "寺院", icon: "temple", area: "祇园", lat: 35.00007, lng: 135.77325, hours: "10:00–17:00，16:30 停止入场", address: "京都市东山区大和大路通四条下小松町", url: "https://www.kenninji.jp/", source: "https://www.kenninji.jp/access/", note: "从花见小路转入寺院，可以把这里加为散步的另一站。" },
    { id: "kodaiji", googlePlaceId: "ChIJuU17z9oIAWARgMhsX3kqUSQ", name: "高台寺", local: "高台寺", en: "Kodai-ji", kind: "寺院", icon: "temple", area: "东山", lat: 35.00083, lng: 135.78148, hours: "通常 09:00–17:30，17:00 停止入场；夜间特别参拜另计", url: "https://www.kodaiji.com/", source: "https://kodaiji.com/haikan.html", note: "沿石墙小路走到高台寺，和二年坂适合排在同一段。" },
    { id: "maruyama", googlePlaceId: "ChIJm6JortwIAWARS811J4oNJus", name: "圆山公园", local: "円山公園", en: "Maruyama Park", kind: "公园", icon: "park", area: "东山", lat: 35.00368, lng: 135.78134, hours: "", address: "京都市东山区圆山町", url: "https://www.city.kyoto.lg.jp/kensetu/page/0000257049.html", source: "https://www.city.kyoto.lg.jp/kensetu/page/0000257049.html", note: "在八坂神社东侧，可作为散步途中的休息点。" },
    { id: "sannen", googlePlaceId: "ChIJr_gZonkIAWARB1xyACZNUKM", name: "三年坂", local: "産寧坂", en: "Sannenzaka", kind: "街区", icon: "street", area: "东山", lat: 34.99738, lng: 135.78148, hours: "", url: "https://ja.kyoto.travel/tourism/single01.php?category_id=8&tourism_id=691", note: "连接二年坂与清水一带的石阶街道。" },
    { id: "gion", googlePlaceId: "ChIJa_GfKgAJAWARdBs1o7x70k0", name: "花见小路", local: "花見小路", en: "Hanamikoji", kind: "街区", icon: "street", area: "祇园", lat: 35.00347, lng: 135.7747, hours: "", url: "https://ja.kyoto.travel/area/area06.php", note: "沿祇园的主街向南散步，可以走到建仁寺。" }
  ].map(p => {
    const place = { short: p.name, url: "", ...p, zh: p.name };
    if (en) Object.assign(place, { name: p.en, short: p.en, area: areaNames[p.area], kind: kinds[p.kind] }, englishDetails[p.id]);
    return place;
  });
  window.atlasData = {
    places,
    routes: [
      { id: "east-walk", zh: "东山经典散步", en: "Higashiyama Highlights", color: "#087e83", status: "complete", stops: ["yasaka", "ninen", "kiyomizu"], minutes: 29, km: 1.7 },
      { id: "gion-walk", zh: "祇园街巷漫步", en: "Gion Backstreets", color: "#c36138", status: "complete", stops: ["gion", "kennin", "arabica"], minutes: 19, km: 1.1 }
    ].map(route => ({...route, name: en ? route.en : route.zh}))
  };
})();
