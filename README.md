![Project Aina · 京都东山步行地图。赭色路线从八坂神社，经二年坂，抵达清水寺。](docs/images/higashiyama-atlas.png)

从八坂神社走到清水寺，二年坂附近有一家想去的咖啡店。把它的照片和神社的开放时间并排放在地图上，看看要绕多远，再决定要不要加这一站。

**Project Aina** 是给喜欢自己安排行程的人做的步行地图。路线沿着街道留在图上，每个地点都能打开一扇独立的窗口。桌面上可以拖开几张卡片慢慢比较，手机上用一张可滑动的底部卡片完成规划。

## 在京都试走一段

1. 在地图上点 **八坂神社**，选 **从这里规划**。地图立即标出第 1 站，新路线以起点命名。
2. 再点 **二年坂**。在桌面上，第一张地点卡仍然开着，可以同时看两处的资料。选 **加入当前路线**，地图便沿街道画出两站之间的步行线。
3. 点 **完成路线**，再去看附近的咖啡店。想改主意时，点地图上的路线或打开 **我的路线**，就能调整站序、复制路线，或接着加站。

![京都离线模式下，八坂神社与高台寺的白色地点窗并排打开，地图中央保留着两条步行路线。](docs/images/kyoto-workspace.png)

内置两条可以直接打开的散步路线。**东山经典散步**从八坂神社经二年坂到清水寺。**祇园街巷漫步**从花见小路经建仁寺到 % Arabica 京都东山。两条路线可以同时显示，也可以分别收起。

## 本地运行

安装 Python 3.9 或更新版本，在项目目录启动。京都示例的地图、照片与步行路网都随仓库提供，首次试走无需 API 密钥。

```sh
git clone https://github.com/azhezyz/Project_Aina.git
cd Project_Aina
```

| 平台 | 启动命令 |
| --- | --- |
| Windows | `py -3 server.py` |
| macOS / Linux | `python3 server.py` |

在浏览器打开 [127.0.0.1:5173](http://127.0.0.1:5173/)。行程按浏览器和网站地址保存在本机，下次用同一个地址打开，就能继续编辑。Windows 上也可以在 VS Code 的「终端 → 运行任务」中选择「启动 Project Aina」。

## 把地图带到其他城市

连接 Google 后，可以直接点底图上的店铺和景点，或在搜索框输入地名和城市后按回车。地点卡按资料可用情况显示照片、营业时间、评分和官网。支持嵌入的官网可以留在地图窗口里看。

1. 在自己的 Google Cloud 项目中关联结算，启用 **Maps JavaScript API**、**Places UI Kit**、**Places API (New)** 和 **Routes API**。
2. 创建浏览器 API 密钥，限制为以上服务，并允许实际使用的网站来源，例如 `http://127.0.0.1:5173/*`。
3. 点击页面右下角的底图状态，在设置中输入密钥即可在当前标签页使用。Windows 可运行 `py -3 server.py --set-key` 将密钥加密保存到当前用户。其他系统也可在启动前设置环境变量 `AINA_GOOGLE_MAPS_BROWSER_KEY`。

在线地图使用 Google 原生图层绘制站点与路线。京都东部优先使用内置步行路网，只有缺少的路段才向 Google Routes 请求。同一页面会复用已算出的路段。高级地点卡使用 Places UI Kit Pro，地点真名按需查询。在线服务的用量计入密钥所属项目。[Google Maps 密钥设置](https://developers.google.com/maps/documentation/javascript/get-api-key) · [Google Maps Platform 计费](https://developers.google.com/maps/billing-and-pricing/pricing)

<details>
<summary><strong>地图上的几个手势</strong></summary>

| 想做的事 | 操作 |
| --- | --- |
| 找一个地点 | 按 <kbd>/</kbd> 聚焦搜索框 |
| 给地图留出空间 | 拖动地点窗标题栏，或折叠单个窗口 |
| 一次收起所有地点窗 | 双击底部短横条，已显示的路线会保留 |
| 查看路线列表 | 向上拖动底部短横条，打开「我的路线」 |
| 收起底部卡片 | 按 <kbd>Esc</kbd> 或向下拖动 |

</details>

## 地图与影像

京都离线底图、步行路网和封面制图使用 © OpenStreetMap contributors 的数据，按 ODbL 1.0 提供。内置照片来自 Wikimedia Commons，每张照片的作者、原图、许可及 WebP 转换说明均可查阅。[OpenStreetMap 署名](https://www.openstreetmap.org/copyright) · [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) · [照片署名清单](web/photo-catalog.js)
