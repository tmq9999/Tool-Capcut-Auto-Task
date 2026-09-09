# Remaining HTTP groups — complete inventory

Every instance is preserved in the per-ID ledger; role review is endpoint/schema-level unless explicitly deeper.

| # | Method / host / sanitized path | Count | Capture IDs | Response kinds |
|---|---|---:|---|---|
| 1 | GET capcut.com / | 1 | 1 | empty |
| 2 | GET www.capcut.com / | 1 | 2 | html |
| 3 | POST www.google-analytics.com /g/collect | 1 | 3 | empty |
| 4 | OPTIONS mcs-normal-sg.capcutapi.com /list | 2 | 4, 1518 | empty |
| 5 | OPTIONS vmweb-normal-sg.capcutapi.com /service/{ref-1256c71cf0d5700420}/abtest_config/ | 3 | 5, 1791, 1792 | empty |
| 6 | POST mcs-normal-sg.capcutapi.com /list | 405 | 6, 26, 68, 78, 85, 135, 142, 160, 180, 197, 201, 210, 213, 221, 223, 229, 242, 243, 246, 247, 248, 249, 265, 352, 353, 360, 418, 424, 433, 442, 452, 465, 474, 479, 480, 487, 488, 492, 497, 499, 503, 649, 948, 967, 990, 1004, 1008, 1029, 1035, 1049, 1134, 1191, 1213, 1214, 1216, 1225, 1231, 1234, 1239, 1241, 1246, 1248, 1249, 1250, 1254, 1256, 1264, 1266, 1271, 1272, 1276, 1280, 1285, 1290, 1296, 1301, 1305, 1311, 1316, 1321, 1328, 1332, 1337, 1342, 1346, 1353, 1357, 1363, 1367, 1374, 1378, 1384, 1390, 1394, 1397, 1404, 1408, 1413, 1416, 1421, 1426, 1432, 1435, 1441, 1445, 1449, 1453, 1459, 1463, 1467, 1470, 1478, 1482, 1486, 1490, 1494, 1500, 1503, 1506, 1509, 1515, 1520, 1523, 1528, 1529, 1530, 1535, 1538, 1541, 1545, 1548, 1549, 1550, 1551, 1552, 1554, 1560, 1563, 1567, 1568, 1569, 1571, 1573, 1574, 1579, 1584, 1586, 1592, 1598, 1600, 1601, 1602, 1603, 1607, 1609, 1610, 1612, 1616, 1621, 1622, 1628, 1631, 1632, 1789, 1790, 1793, 1798, 1801, 1808, 1815, 1822, 1824, 1836, 1837, 1843, 1845, 1848, 1863, 1901, 1903, 1922, 1926, 1933, 1936, 1938, 1939, 1940, 1941, 1942, 1945, 1955, 1956, 1959, 1964, 1975, 1978, 1982, 1986, 1992, 1998, 1999, 2000, 2001, 2004, 2006, 2015, 2026, 2030, 2040, 2051, 2059, 2066, 2067, 2078, 2084, 2088, 2089, 2104, 2105, 2106, 2108, 2109, 2111, 2112, 2113, 2115, 2116, 2117, 2180, 2181, 2186, 2192, 2204, 2218, 2225, 2235, 2238, 2258, 2293, 2316, 2321, 2340, 2348, 2354, 2357, 2377, 2380, 2390, 2396, 2397, 2400, 2402, 2403, 2406, 2407, 2410, 2413, 2416, 2419, 2422, 2430, 2437, 2441, 2442, 2445, 2448, 2451, 2453, 2455, 2460, 2486, 2487, 2494, 2495, 2500, 2501, 2503, 2508, 2512, 2513, 2515, 2522, 2523, 2524, 2529, 2532, 2533, 2535, 2537, 2538, 2557, 2562, 2575, 2577, 2582, 2586, 2587, 2592, 2596, 2598, 2600, 2606, 2615, 2616, 2620, 2622, 2624, 2625, 2631, 2632, 2637, 2638, 2639, 2640, 2641, 2643, 2650, 2667, 2683, 2686, 2757, 2758, 2759, 2766, 2769, 2788, 2789, 2795, 2800, 2805, 2816, 2818, 2819, 2821, 2827, 2841, 2846, 2847, 2850, 2852, 2854, 2856, 2857, 2860, 2868, 2873, 2876, 2879, 2883, 2891, 2892, 2893, 2896, 2898, 2899, 2900, 2906, 2907, 2908, 2923, 2926, 2931, 2932, 2939, 2940, 2941, 2943, 2944, 2945, 2947, 2948, 2950, 2951, 2953, 2956, 2960, 2963, 2966, 2967, 2971, 2972, 3004, 3005, 3011, 3046, 3065, 3077, 3088, 3089, 3096, 3099, 3107, 3109, 3112, 3124, 3126, 3129, 3134, 3146, 3150, 3159, 3162, 3165, 3178, 3179 | json |
| 7 | POST vmweb-normal-sg.capcutapi.com /service/{ref-1256c71cf0d5700420}/abtest_config/ | 13 | 7, 130, 251, 350, 351, 1814, 1821, 2178, 2179, 2755, 2756, 3013, 3014 | json |
| 8 | GET www.capcut.com /manifest.json | 3 | 8, 270, 1643 | json |
| 9 | GET sf16-sg.tiktokcdn.com /obj/eden-sg/bvfllz_vlkpc_nb/ljhwZthlaukjlkulzlp/seeyoujs/{ref-dac056a0ca42ad55d8}/{ref-29ef6f3e469fe8cc4b}/en.314cb.json | 1 | 9 | json |
| 10 | POST mon-sg.capcutapi.com /monitor_browser/collect/batch/ | 471 | 24, 39, 40, 41, 42, 43, 50, 70, 72, 79, 90, 91, 101, 119, 126, 141, 143, 144, 145, 151, 154, 155, 164, 256, 257, 258, 267, 271, 333, 381, 392, 420, 437, 443, 466, 467, 489, 490, 493, 494, 500, 505, 650, 923, 946, 949, 953, 954, 956, 960, 961, 962, 963, 964, 965, 968, 969, 977, 978, 1026, 1040, 1053, 1059, 1072, 1084, 1098, 1111, 1119, 1129, 1133, 1139, 1145, 1150, 1156, 1163, 1168, 1169, 1170, 1171, 1172, 1192, 1193, 1195, 1196, 1197, 1198, 1199, 1200, 1201, 1202, 1203, 1204, 1205, 1206, 1207, 1208, 1209, 1218, 1222, 1226, 1227, 1228, 1229, 1232, 1233, 1235, 1236, 1237, 1238, 1240, 1242, 1245, 1251, 1255, 1259, 1265, 1268, 1283, 1284, 1292, 1294, 1300, 1303, 1304, 1306, 1308, 1310, 1312, 1314, 1319, 1320, 1322, 1325, 1327, 1329, 1331, 1333, 1338, 1341, 1343, 1345, 1348, 1349, 1352, 1354, 1358, 1362, 1364, 1366, 1368, 1370, 1373, 1375, 1380, 1383, 1386, 1389, 1391, 1393, 1395, 1400, 1403, 1405, 1407, 1409, 1411, 1414, 1418, 1422, 1423, 1425, 1427, 1430, 1431, 1433, 1436, 1438, 1442, 1444, 1446, 1448, 1451, 1454, 1456, 1460, 1462, 1464, 1466, 1468, 1472, 1473, 1475, 1479, 1481, 1483, 1487, 1488, 1491, 1495, 1498, 1501, 1504, 1507, 1512, 1514, 1517, 1521, 1524, 1531, 1536, 1540, 1543, 1553, 1556, 1562, 1570, 1572, 1576, 1578, 1580, 1582, 1585, 1587, 1591, 1593, 1595, 1597, 1604, 1613, 1617, 1619, 1620, 1623, 1627, 1629, 1630, 1633, 1634, 1636, 1644, 1654, 1717, 1723, 1740, 1754, 1775, 1783, 1785, 1786, 1800, 1828, 1830, 1842, 1846, 1847, 1850, 1851, 1852, 1853, 1854, 1855, 1856, 1857, 1858, 1859, 1860, 1861, 1862, 1864, 1865, 1866, 1868, 1869, 1870, 1871, 1872, 1874, 1875, 1876, 1877, 1878, 1887, 1898, 1902, 1923, 1927, 1928, 1929, 1930, 1943, 1946, 1960, 1965, 1967, 1969, 1970, 1973, 1996, 2005, 2009, 2012, 2014, 2019, 2021, 2022, 2024, 2034, 2037, 2042, 2044, 2047, 2049, 2052, 2055, 2058, 2060, 2061, 2070, 2077, 2079, 2095, 2101, 2102, 2118, 2127, 2228, 2239, 2252, 2290, 2306, 2313, 2326, 2347, 2349, 2350, 2351, 2355, 2356, 2360, 2361, 2362, 2363, 2364, 2365, 2366, 2368, 2369, 2371, 2372, 2373, 2375, 2376, 2381, 2389, 2392, 2393, 2395, 2398, 2401, 2405, 2408, 2411, 2412, 2439, 2443, 2446, 2457, 2459, 2461, 2464, 2466, 2483, 2484, 2489, 2491, 2496, 2497, 2504, 2520, 2531, 2536, 2540, 2541, 2542, 2555, 2556, 2558, 2563, 2564, 2566, 2569, 2571, 2572, 2591, 2595, 2597, 2601, 2602, 2603, 2607, 2611, 2612, 2618, 2619, 2627, 2628, 2634, 2644, 2645, 2647, 2651, 2664, 2665, 2671, 2672, 2675, 2684, 2685, 2687, 2688, 2718, 2744, 2786, 2790, 2792, 2801, 2807, 2808, 2823, 2825, 2829, 2831, 2832, 2833, 2844, 2851, 2859, 2880, 2903, 2909, 2912, 2914, 2916, 2919, 2921, 2969, 2973, 2974, 2975, 3064, 3078, 3086, 3087, 3105, 3106, 3110, 3125, 3128, 3130, 3135, 3136, 3138, 3147, 3148, 3169, 3171, 3173, 3175, 3302, 3303, 3304 | empty |
| 11 | GET www.capcut.com /api/v1/web-cookie-privacy/config | 7 | 25, 102, 273, 1647, 2125, 2689, 2991 | json |
| 12 | OPTIONS edit-api-sg.capcut.com /lv/v1/event/report | 7 | 27, 107, 255, 275, 283, 1652, 1655 | empty |
| 13 | OPTIONS mon-sg.capcutapi.com /monitor_web/settings/browser-settings | 9 | 29, 45, 95, 96, 272, 1658, 1752, 2119, 2669 | empty |
| 14 | OPTIONS mon-sg.capcutapi.com /monitor_browser/collect/batch/security/ | 13 | 30, 158, 159, 291, 1287, 1881, 1882, 2384, 2385, 2862, 2863, 2979, 3278 | empty |
| 15 | POST mon-sg.capcutapi.com /monitor_browser/collect/batch/security/ | 16 | 31, 161, 162, 299, 1288, 1885, 1886, 2386, 2387, 2806, 2864, 2865, 2981, 3104, 3137, 3282 | empty |
| 16 | GET mon-sg.capcutapi.com /monitor_web/settings/browser-settings | 26 | 32, 47, 97, 99, 114, 128, 281, 282, 286, 422, 1646, 1667, 1762, 1788, 2126, 2130, 2157, 2299, 2670, 2694, 2709, 2791, 2982, 2993, 3002, 3090 | json |
| 17 | GET edit-api-sg.capcut.com /lv/v1/event/report | 9 | 33, 118, 288, 296, 1669, 1682, 2120, 2676, 2983 | json |
| 18 | OPTIONS mon-sg.capcutapi.com /monitor_browser/collect/batch/ | 17 | 34, 35, 36, 37, 38, 69, 116, 117, 150, 163, 354, 1618, 1777, 1778, 1825, 2036, 2706 | empty |
| 19 | OPTIONS mon.tiktokv.com /monitor_web/settings/browser-settings | 2 | 46, 1753 | json |
| 20 | GET accounts.google.com /gsi/client | 1 | 48 | javascript |
| 21 | GET www.googletagmanager.com /gtag/js | 2 | 49, 2754 | javascript |
| 22 | POST www.google.com /rmkt/collect/{ref-84aa1fc55498fc0ae8}/ | 7 | 51, 121, 355, 1794, 2183, 2775, 3007 | empty |
| 23 | POST www.google.com /ccm/collect | 7 | 52, 122, 356, 1795, 2184, 2776, 3008 | empty |
| 24 | POST analytics.google.com /g/collect | 28 | 53, 123, 140, 156, 208, 240, 241, 263, 358, 1022, 1638, 1797, 1892, 1971, 2092, 2185, 2374, 2458, 2673, 2691, 2779, 2843, 2849, 2901, 2978, 3010, 3131, 3305 | empty |
| 25 | GET www.clarity.ms /tag/uet/{ref-3a03fd82ad8286bc38} | 7 | 54, 124, 391, 1806, 2187, 2760, 3019 | javascript |
| 26 | POST bat.bing.com /actionp/{ref-2eaaf3cc69b2b4cede} | 34 | 55, 57, 58, 125, 132, 133, 264, 266, 387, 388, 389, 393, 1639, 1802, 1803, 1804, 1951, 2081, 2188, 2189, 2190, 2425, 2674, 2692, 2761, 2762, 2763, 2837, 2869, 2977, 3015, 3016, 3017, 3306 | empty |
| 27 | POST ad.doubleclick.net /ccm/s/collect | 4 | 56, 1799, 2777, 3009 | empty |
| 28 | GET bat.bing.com /action/{ref-2eaaf3cc69b2b4cede} | 17 | 59, 82, 83, 84, 134, 238, 390, 400, 1805, 1953, 2083, 2193, 2426, 2764, 2838, 2871, 3018 | empty |
| 29 | POST stats.g.doubleclick.net /g/collect | 1 | 60 | empty |
| 30 | GET googleads.g.doubleclick.net /pagead/viewthroughconversion/{ref-84aa1fc55498fc0ae8}/ | 7 | 61, 120, 357, 1796, 2182, 2774, 3006 | javascript |
| 31 | GET accounts.google.com /gsi/fedcm.json | 1 | 62 | json |
| 32 | GET google.com /.well-known/web-identity | 1 | 63 | html |
| 33 | POST update.googleapis.com /service/{ref-68035fad5e0f286f88}/json | 16 | 64, 77, 80, 175, 186, 187, 192, 202, 206, 219, 548, 1258, 1299, 1324, 1351, 1385 | invalid-json |
| 34 | GET mon.tiktokv.com /monitor_web/settings/browser-settings | 7 | 65, 115, 287, 1784, 2158, 2711, 3003 | json |
| 35 | GET www.google.com /.well-known/web-identity | 1 | 66 | json |
| 36 | GET accounts.google.com /gsi/fedcm/listaccounts | 1 | 67 | json |
| 37 | OPTIONS mon.tiktokv.com /monitor_browser/collect/batch/ | 2 | 71, 1961 | empty |
| 38 | POST android.clients.google.com /{ref-b64741cef2e235edcb}/{ref-f9df2e58525d30bb22} | 6 | 73, 100, 217, 1377, 1670, 2046 | text |
| 39 | POST mon.tiktokv.com /monitor_browser/collect/batch/ | 11 | 74, 89, 146, 259, 491, 1966, 2096, 2444, 2646, 2845, 2881 | empty |
| 40 | POST accounts.google.com /ListAccounts | 1 | 75 | empty |
| 41 | GET www.google.com /async/folae | 1 | 76 | binary |
| 42 | GET sf16-web-tos-buz.capcutstatic.com /obj/capcut-web-buz-sg/CapCutSans/CapCutSansText-Regular.otf | 1 | 86 | binary |
| 43 | GET sf16-web-tos-buz.capcutstatic.com /obj/capcut-web-buz-sg/CapCutSans/CapCutSansText-Medium.otf | 1 | 87 | binary |
| 44 | GET sf16-web-tos-buz.capcutstatic.com /obj/capcut-web-buz-sg/CapCutSans/CapCutSansText-Bold.otf | 1 | 88 | binary |
| 45 | GET sf16-web-tos-buz.capcutcdn-us.com /obj/capcut-web-buz-tx/CapCutSans/CapCutSansText-Bold.otf | 1 | 92 | binary |
| 46 | GET sf16-web-tos-buz.capcutcdn-us.com /obj/capcut-web-buz-tx/CapCutSans/CapCutSansText-Medium.otf | 1 | 93 | binary |
| 47 | GET sf16-web-tos-buz.capcutcdn-us.com /obj/capcut-web-buz-tx/CapCutSans/CapCutSansText-Regular.otf | 1 | 94 | binary |
| 48 | GET starling-normal-sg.capcutapi.com /check_and_get_text/{ref-1d1a7a29cfc0b34e7e}/normal/WebClient | 1 | 98 | json |
| 49 | GET accounts.google.com /gsi/button | 4 | 103, 104, 105, 106 | html |
| 50 | GET mssdk-sg.capcutapi.com /web/resource | 6 | 113, 335, 1755, 2229, 2767, 3061 | json |
| 51 | POST bat.bing.net /actionp/{ref-2eaaf3cc69b2b4cede} | 2 | 127, 269 | empty |
| 52 | GET starling-normal-sg.capcutapi.com /check_and_get_text/{ref-861270a8264b9aa1b6}/normal/{ref-f288b48bf67d2c57f4} | 6 | 129, 300, 1659, 2207, 2713, 2996 | json |
| 53 | GET bat.bing.net /action/{ref-2eaaf3cc69b2b4cede} | 1 | 131 | empty |
| 54 | OPTIONS vcs-sg.capcutapi.com /vc/setting | 2 | 136, 1661 | empty |
| 55 | POST vcs-sg.capcutapi.com /vc/setting | 6 | 139, 302, 1696, 2205, 2712, 2995 | json |
| 56 | POST o.clarity.ms /collect | 70 | 147, 177, 178, 179, 183, 185, 188, 200, 205, 207, 218, 227, 268, 478, 647, 1010, 1194, 1219, 1243, 1252, 1260, 1282, 1293, 1309, 1326, 1335, 1347, 1361, 1371, 1387, 1398, 1412, 1429, 1450, 1471, 1493, 1513, 1537, 1575, 1596, 1637, 1841, 1879, 1891, 1931, 1944, 1952, 1957, 1963, 1968, 1972, 1974, 2002, 2010, 2018, 2029, 2043, 2057, 2082, 2087, 2098, 2110, 2191, 2456, 2490, 2543, 2567, 2608, 2626, 2693 | empty |
| 57 | OPTIONS play.google.com /log | 9 | 170, 3234, 3235, 3236, 3237, 3238, 3239, 3240, 3241 | empty |
| 58 | POST play.google.com /log | 11 | 171, 3251, 3252, 3253, 3254, 3255, 3256, 3257, 3258, 3309, 3310 | json |
| 59 | GET content-autofill.googleapis.com /v1/pages/{ref-d73e363fb8ef842b23} | 1 | 181 | binary |
| 60 | GET content-autofill.googleapis.com /v1/pages/{ref-18e56e1c920c731956} | 1 | 182 | binary |
| 61 | GET content-autofill.googleapis.com /v1/pages/{ref-3658c83c1536cfc452} | 2 | 198, 239 | binary |
| 62 | POST www.capcut.com /lv/v1/sc/age_gate/get_age_gate_config | 1 | 211 | json |
| 63 | POST passwordsleakcheck-pa.googleapis.com /v1/{ref-21208d561ad46c4914} | 1 | 212 | binary |
| 64 | GET content-autofill.googleapis.com /v1/pages/{ref-c4307a88521c8e24fd} | 1 | 214 | binary |
| 65 | POST content-autofill.googleapis.com /v1/{ref-3a458d4f68d056b03d} | 4 | 215, 216, 225, 236 | binary |
| 66 | POST www.capcut.com /lv/v1/sc/age_gate/check_age_without_uid | 1 | 220 | json |
| 67 | GET content-autofill.googleapis.com /v1/pages/{ref-e1539337aaa25d0b4b} | 1 | 226 | binary |
| 68 | POST www.capcut.com /lv/v1/sc/age_gate/set_birthday_by_uid | 1 | 235 | json |
| 69 | POST www.capcut.com /lv/v1/user/web/user_info | 1 | 237 | json |
| 70 | POST www.google.com /measurement/conversion | 1 | 245 | empty |
| 71 | GET www.capcut.com /my-edit | 2 | 250, 1642 | html |
| 72 | OPTIONS edit-api-sg.capcut.com /cc/v1/workspace/get_user_workspaces | 2 | 252, 2696 | empty |
| 73 | OPTIONS edit-api-sg.capcut.com /cc/v1/workspace/mget_workspace_info | 2 | 253, 2122 | empty |
| 74 | OPTIONS edit-api-sg.capcut.com /cc/v1/workspace/get_all_everphoto_user | 2 | 254, 2121 | empty |
| 75 | GET www.google.com /measurement/{ref-1dfda5d794b78e8b8a}/ | 1 | 262 | empty |
| 76 | OPTIONS edit-api-sg.capcut.com /lv/v1/persona/get_questionnaire | 1 | 274 | empty |
| 77 | POST edit-api-sg.capcut.com /cc/v1/workspace/get_all_everphoto_user | 5 | 276, 1649, 2170, 2678, 2985 | json |
| 78 | POST edit-api-sg.capcut.com /cc/v1/workspace/mget_workspace_info | 5 | 277, 1650, 2168, 2679, 2986 | json |
| 79 | POST edit-api-sg.capcut.com /cc/v1/workspace/get_user_workspaces | 4 | 278, 1648, 2723, 3027 | json |
| 80 | POST edit-api-sg.capcut.com /lv/v1/persona/get_questionnaire | 1 | 289 | json |
| 81 | OPTIONS aha.byteintlapi.com /api/reporting/crash | 6 | 298, 1286, 1883, 2383, 2861, 3277 | empty |
| 82 | OPTIONS edit-api-sg.capcut.com /lv/v1/web/homepage/get_guide_show | 1 | 303 | empty |
| 83 | GET lf16-beecdn.ibytedtos.com /obj/ies-fe-bee-sg/bee_prod/{ref-f7a539f4bbd738a38a}/bee_prod_149_bee_publish_565.json | 3 | 307, 1671, 2173 | json, empty |
| 84 | GET lf16-beecdn.ibytedtos.com /obj/ies-fe-bee-sg/bee_prod/{ref-f7a539f4bbd738a38a}/bee_prod_149_bee_publish_898.json | 2 | 310, 1675 | json, empty |
| 85 | OPTIONS edit-api-sg.capcut.com /lv/v1/notice/get_unread_count | 1 | 311 | empty |
| 86 | POST aha.byteintlapi.com /api/reporting/crash | 6 | 313, 1289, 1888, 2388, 2866, 3281 | json |
| 87 | OPTIONS edit-api-sg.capcut.com /lv/v1/third_party_clouds/user_info | 4 | 317, 319, 1681, 1683 | empty |
| 88 | GET edit-api-sg.capcut.com /lv/v1/web/homepage/get_guide_show | 2 | 318, 1709 | json |
| 89 | OPTIONS edit-api-sg.capcut.com /lv/v1/common_task/list | 4 | 320, 321, 2073, 2074 | empty |
| 90 | OPTIONS edit-api-sg.capcut.com /lv/v1/{ref-0a0e53fb4806c754fb}/{ref-665bf0ced82997b2f0} | 1 | 322 | empty |
| 91 | OPTIONS edit-api-sg.capcut.com /lv/v1/user/web/share_user_info | 2 | 323, 325 | empty |
| 92 | OPTIONS edit-api-sg.capcut.com /lv/v1/user/check_age_gate | 1 | 324 | empty |
| 93 | OPTIONS edit-api-sg.capcut.com /lv/v1/start_page/get_tool_list | 1 | 337 | empty |
| 94 | POST edit-api-sg.capcut.com /lv/v1/third_party_clouds/user_info | 4 | 339, 379, 1695, 1716 | json |
| 95 | GET sf16-tcc-tos-sg.byteoversea.com /obj/tcc-config-web-alisg/tcc-v2-data-ies.capcut.web-business | 2 | 340, 1705 | json, empty |
| 96 | POST edit-api-sg.capcut.com /lv/v1/notice/get_unread_count | 4 | 341, 1372, 1485, 1672 | json |
| 97 | OPTIONS edit-api-sg.capcut.com /lv/v1/start_page/get_imc_resource | 1 | 342 | empty |
| 98 | GET frontier-sg.capcut.com /ws/v2 | 9 | 344, 362, 1678, 1735, 2234, 2429, 2710, 2809, 3123 | empty |
| 99 | OPTIONS feed-api-sg.capcut.com /lv/v1/platform/get_customer_service_portal | 2 | 347, 1676 | empty |
| 100 | GET www.googletagmanager.com /a | 2 | 361, 2830 | empty |
| 101 | OPTIONS edit-api-sg.capcut.com /artist/v1/effect/get_resources_by_category_id | 7 | 369, 370, 2163, 2300, 2301, 2302, 2303 | empty |
| 102 | POST edit-api-sg.capcut.com /lv/v1/{ref-0a0e53fb4806c754fb}/{ref-665bf0ced82997b2f0} | 2 | 372, 1686 | json |
| 103 | POST edit-api-sg.capcut.com /lv/v1/common_task/list | 48 | 373, 374, 525, 526, 1262, 1263, 1297, 1298, 1317, 1318, 1339, 1340, 1359, 1360, 1381, 1382, 1401, 1402, 1419, 1420, 1439, 1440, 1457, 1458, 1476, 1477, 1496, 1497, 1510, 1511, 1533, 1534, 1557, 1558, 1589, 1590, 1624, 1625, 1684, 1685, 1838, 1839, 1979, 1980, 2032, 2033, 2075, 2076 | json |
| 104 | POST edit-api-sg.capcut.com /lv/v1/user/check_age_gate | 2 | 375, 1688 | json |
| 105 | POST edit-api-sg.capcut.com /lv/v1/user/web/share_user_info | 4 | 376, 378, 1687, 1689 | json |
| 106 | POST edit-api-sg.capcut.com /lv/v1/start_page/get_tool_list | 2 | 395, 1691 | json |
| 107 | POST edit-api-sg.capcut.com /artist/v1/effect/get_resources_by_category_id | 67 | 397, 413, 476, 477, 495, 496, 501, 502, 842, 1000, 1005, 1173, 1174, 1175, 1176, 1177, 1178, 1179, 1180, 1181, 1182, 1183, 1184, 1185, 1186, 1187, 1188, 1189, 1190, 1711, 1712, 1718, 1719, 1721, 1722, 1725, 1726, 1736, 1895, 1899, 1904, 1905, 1906, 1907, 1908, 1909, 1910, 1911, 1912, 1913, 1914, 1915, 1916, 1917, 1918, 1919, 1920, 1921, 2202, 2292, 2311, 2312, 2314, 2317, 2344, 2346, 2352 | json |
| 108 | GET lf16-beecdn.ibytedtos.com /obj/ies-fe-bee-sg/bee_prod/{ref-f7a539f4bbd738a38a}/bee_prod_149_bee_publish_1154.json | 3 | 399, 1741, 3023 | json, empty |
| 109 | GET lf16-beecdn.ibytedtos.com /obj/ies-fe-bee-sg/bee_prod/{ref-f7a539f4bbd738a38a}/bee_prod_149_bee_publish_978.json | 4 | 401, 1742, 2749, 3025 | json, empty |
| 110 | OPTIONS edit-api-sg.capcut.com /lv/v1/user/web/user_permissions | 2 | 403, 2215 | empty |
| 111 | POST edit-api-sg.capcut.com /lv/v1/start_page/get_imc_resource | 2 | 412, 1697 | json |
| 112 | OPTIONS edit-api-sg.capcut.com /cc/v1/workspace/get_member | 2 | 416, 417 | empty |
| 113 | OPTIONS edit-api-sg.capcut.com /cc/v1/workspace/check_create_workspace | 2 | 419, 3152 | empty |
| 114 | GET www.capcut.com /static-resource/ies/ccweb/scm_storage/sdk/ever_cloud_sdk/1.1120.4-cc-remove-blob-8/825b6ee886c926c9ef85.wasm | 3 | 421, 2782, 3063 | binary |
| 115 | POST feed-api-sg.capcut.com /lv/v1/platform/get_customer_service_portal | 2 | 423, 1713 | json |
| 116 | POST edit-api-sg.capcut.com /cc/v1/workspace/get_member | 4 | 430, 475, 1702, 1703 | json |
| 117 | POST edit-api-sg.capcut.com /lv/v1/user/web/user_permissions | 5 | 431, 1743, 2250, 2695, 3026 | json |
| 118 | POST edit-api-sg.capcut.com /cc/v1/workspace/check_create_workspace | 3 | 432, 1704, 3160 | json |
| 119 | OPTIONS edit-api-sg.capcut.com /lv/v1/start_page/report_imc_open | 1 | 439 | empty |
| 120 | OPTIONS edit-api-sg.capcut.com /artist/v1/homepage/get_effect_list | 4 | 444, 1758, 2770, 3055 | empty |
| 121 | OPTIONS edit-api-sg.capcut.com /artist/v1/effect/user_favorite_list | 2 | 445, 2771 | empty |
| 122 | POST edit-api-sg.capcut.com /lv/v1/start_page/report_imc_open | 1 | 446 | json |
| 123 | OPTIONS edit-api-sg.capcut.com /lv/v1/web/homepage/record_guide_show | 1 | 447 | empty |
| 124 | OPTIONS edit-api-sg.capcut.com /artist/v1/panel/get_panel_info | 9 | 451, 454, 1006, 1760, 1896, 1900, 2719, 2720, 3024 | empty |
| 125 | GET content-autofill.googleapis.com /v1/pages/{ref-3a012ee91a43056b8a} | 2 | 453, 1757 | binary |
| 126 | POST edit-api-sg.capcut.com /lv/v1/web/homepage/record_guide_show | 2 | 462, 1826 | json |
| 127 | POST edit-api-sg.capcut.com /artist/v1/effect/user_favorite_list | 4 | 463, 1759, 2783, 3056 | json |
| 128 | POST edit-api-sg.capcut.com /artist/v1/homepage/get_effect_list | 6 | 464, 1763, 2787, 3069, 3093, 3094 | json |
| 129 | POST edit-api-sg.capcut.com /artist/v1/panel/get_panel_info | 16 | 468, 469, 1001, 1021, 1764, 1765, 1924, 1925, 2726, 2727, 2772, 3044, 3049, 3050, 3051, 3057 | json |
| 130 | GET www.capcut.com /editor-page-resource.json | 2 | 514, 1809 | json |
| 131 | POST www.capcut.com /lv/v1/sc/compliance_popup/fetch_all | 3 | 698, 1817, 2171 | json |
| 132 | POST www.capcut.com /lv/v1/sc/age_gate/{ref-810786e2d07eaf0bf7} | 5 | 952, 1823, 2177, 2753, 3001 | json |
| 133 | OPTIONS sg-gcp.evercloud.capcut.com /sf/{ref-3e7f3331f9bd19cc9a}/v5/GetUpdates | 6 | 958, 996, 2062, 2559, 2604, 2648 | empty |
| 134 | GET sg-gcp.evercloud.capcut.com /sf/{ref-3e7f3331f9bd19cc9a}/v5/GetUpdates | 35 | 983, 1012, 1261, 1295, 1315, 1336, 1356, 1376, 1396, 1415, 1434, 1452, 1469, 1489, 1505, 1522, 1544, 1583, 1606, 1787, 1807, 1977, 2028, 2064, 2172, 2221, 2379, 2399, 2414, 2485, 2498, 2561, 2605, 2613, 2649 | json |
| 135 | OPTIONS edit-api-sg.capcut.com /lv/v1/ad_maker/user/get_enable_list | 1 | 994 | empty |
| 136 | GET www.capcut.com /magic-tools/tools-page-resource.json | 2 | 998, 1893 | json |
| 137 | GET www.capcut.com /magic-tools/new-tools-page-resource.json | 2 | 999, 1894 | json |
| 138 | POST edit-api-sg.capcut.com /lv/v1/ad_maker/user/get_enable_list | 2 | 1015, 1819 | json |
| 139 | OPTIONS edit-api-sg.capcut.com /lv/v1/user/web/check_bind_email_popup | 1 | 1032 | empty |
| 140 | POST edit-api-sg.capcut.com /lv/v1/user/web/check_bind_email_popup | 2 | 1045, 1827 | json |
| 141 | GET www.capcut.com /ai-creator/page-resource.json | 10 | 1220, 1221, 1223, 1820, 1829, 1840, 2705, 3040, 3132, 3144 | json |
| 142 | GET www.capcut.com /editor-wasm-resource.json | 2 | 1247, 1932 | json |
| 143 | OPTIONS edit-api-sg.capcut.com /lv/v1/persona/submit_questionnaire | 1 | 1270 | empty |
| 144 | POST edit-api-sg.capcut.com /lv/v1/persona/submit_questionnaire | 1 | 1273 | json |
| 145 | GET lf16-beecdn.ibytedtos.com /obj/ies-fe-bee-sg/bee_prod/{ref-f7a539f4bbd738a38a}/bee_prod_149_bee_publish_1213.json | 4 | 1525, 1645, 2677, 2984 | json, empty |
| 146 | POST www.capcut.com /cloudpush/app_notice_status/ | 4 | 1527, 1890, 2725, 3021 | json |
| 147 | GET www.google.com /complete/search | 2 | 1640, 1641 | javascript |
| 148 | OPTIONS firebaseinstallations.googleapis.com /v1/projects/capcut-web/installations | 1 | 1844 | empty |
| 149 | POST firebaseinstallations.googleapis.com /v1/projects/capcut-web/installations | 1 | 1849 | json |
| 150 | OPTIONS fcmregistrations.googleapis.com /v1/projects/capcut-web/registrations | 1 | 1880 | empty |
| 151 | POST fcmregistrations.googleapis.com /v1/projects/capcut-web/registrations | 1 | 1884 | json |
| 152 | POST www.capcut.com /cloudpush/update_sender_token/ | 3 | 1889, 2716, 3012 | json |
| 153 | OPTIONS edit-api-sg.capcut.com /lv/v1/common_task/new | 1 | 1985 | empty |
| 154 | POST edit-api-sg.capcut.com /lv/v1/common_task/new | 1 | 1988 | json |
| 155 | GET sf16-web-tos-buz.capcutstatic.com /obj/capcut-web-buz-sg/ies.lvve-os.graphic/font/en_new.zip | 1 | 2131 | binary |
| 156 | GET sf16-web-tos-buz.capcutstatic.com /obj/capcut-web-buz-sg/ies.lvve-os.graphic/font/ja.zip | 1 | 2132 | binary |
| 157 | GET sf16-web-tos-buz.capcutstatic.com /obj/capcut-web-buz-sg/ies.lvve-os.graphic/font/th.zip | 1 | 2133 | binary |
| 158 | GET sf16-web-tos-buz.capcutstatic.com /obj/capcut-web-buz-sg/ies.lvve-os.graphic/font/emoji.zip | 1 | 2134 | binary |
| 159 | GET sf16-web-tos-buz.capcutstatic.com /obj/capcut-web-buz-sg/ies.lvve-os.graphic/font/zh-hans.zip | 1 | 2135 | binary |
| 160 | GET sf16-web-tos-buz.capcutstatic.com /obj/capcut-web-buz-sg/ies.lvve-os.graphic/font/zh-hant.zip | 1 | 2136 | binary |
| 161 | GET sf16-web-tos-buz.capcutstatic.com /obj/capcut-web-buz-sg/ies.lvve-os.graphic/font/ko.zip | 1 | 2137 | binary |
| 162 | GET sf16-web-tos-buz.capcutstatic.com /obj/capcut-web-buz-sg/ies.lvve-os.graphic/font/NotoSans-Regular.zip | 1 | 2138 | binary |
| 163 | GET sf16-web-tos-buz.capcutstatic.com /obj/capcut-web-buz-sg/ies.lvve-os.graphic/font/NotoSansSymbols2-Regular.zip | 1 | 2139 | binary |
| 164 | GET sf16-web-tos-buz.capcutstatic.com /obj/capcut-web-buz-sg/ies.lvve-os.graphic/font/NotoSansArabic-Regular.zip | 1 | 2140 | binary |
| 165 | GET sf16-web-tos-buz.capcutstatic.com /obj/capcut-web-buz-sg/ies.lvve-os.graphic/font/NotoSansBengali-Regular.zip | 1 | 2141 | binary |
| 166 | GET sf16-web-tos-buz.capcutstatic.com /obj/capcut-web-buz-sg/ies.lvve-os.graphic/font/NotoSansHebrew-Regular.zip | 1 | 2142 | binary |
| 167 | GET sf16-web-tos-buz.capcutstatic.com /obj/capcut-web-buz-sg/ies.lvve-os.graphic/font/NotoSansKhmer-Regular.zip | 1 | 2143 | binary |
| 168 | GET sf16-web-tos-buz.capcutstatic.com /obj/capcut-web-buz-sg/ies.lvve-os.graphic/font/NotoSansMyanmar-Regular.zip | 1 | 2144 | binary |
| 169 | GET sf16-web-tos-buz.capcutstatic.com /obj/capcut-web-buz-sg/ies.lvve-os.graphic/font/NotoSansThai-Regular.zip | 1 | 2145 | binary |
| 170 | GET sf16-web-tos-buz.capcutstatic.com /obj/capcut-web-buz-sg/ies.lvve-os.graphic/font/NotoSansArmenian-Regular.zip | 1 | 2146 | binary |
| 171 | GET sf16-web-tos-buz.capcutstatic.com /obj/capcut-web-buz-sg/ies.lvve-os.graphic/font/NotoSansCanadianAboriginal-Regular.zip | 1 | 2147 | binary |
| 172 | GET sf16-web-tos-buz.capcutstatic.com /obj/capcut-web-buz-sg/ies.lvve-os.graphic/font/NotoSansEthiopic-Regular.zip | 1 | 2148 | binary |
| 173 | GET sf16-web-tos-buz.capcutstatic.com /obj/capcut-web-buz-sg/ies.lvve-os.graphic/font/NotoSansGeorgian-Regular.zip | 1 | 2149 | binary |
| 174 | GET sf16-web-tos-buz.capcutstatic.com /obj/capcut-web-buz-sg/ies.lvve-os.graphic/font/NotoSansGujarati-Regular.zip | 1 | 2150 | binary |
| 175 | GET sf16-web-tos-buz.capcutstatic.com /obj/capcut-web-buz-sg/ies.lvve-os.graphic/font/NotoSansGurmukhi-Regular.zip | 1 | 2151 | binary |
| 176 | GET sf16-web-tos-buz.capcutstatic.com /obj/capcut-web-buz-sg/ies.lvve-os.graphic/font/NotoSansKannada-Regular.zip | 1 | 2152 | binary |
| 177 | GET sf16-web-tos-buz.capcutstatic.com /obj/capcut-web-buz-sg/ies.lvve-os.graphic/font/NotoSansLao-Regular.zip | 1 | 2153 | binary |
| 178 | GET sf16-web-tos-buz.capcutstatic.com /obj/capcut-web-buz-sg/ies.lvve-os.graphic/font/NotoSansMalayalam-Regular.zip | 1 | 2154 | binary |
| 179 | GET sf16-web-tos-buz.capcutstatic.com /obj/capcut-web-buz-sg/ies.lvve-os.graphic/font/NotoSansTamil-Regular.zip | 1 | 2155 | binary |
| 180 | GET sf16-web-tos-buz.capcutstatic.com /obj/capcut-web-buz-sg/ies.lvve-os.graphic/font/NotoSansTelugu-Regular.zip | 1 | 2156 | binary |
| 181 | GET www.capcut.com /static-resource/ies/ccweb/scm_storage/sdk/graphic/wasm/effect_c_b05ec3a91ffc232f092e2b385b404b49.wasm | 1 | 2160 | binary |
| 182 | OPTIONS edit-api-sg.capcut.com /lv/v1/editor/template/recent_list | 1 | 2161 | empty |
| 183 | OPTIONS edit-api-sg.capcut.com /lv/v2/editor/effect/recent_list | 3 | 2162, 2219, 2220 | empty |
| 184 | OPTIONS edit-api-sg.capcut.com /lv/v1/cc_web/plane/get_collection_templates | 1 | 2164 | empty |
| 185 | OPTIONS edit-api-sg.capcut.com /cc/v1/workspace/web/get_brand_list | 1 | 2165 | empty |
| 186 | POST edit-api-sg.capcut.com /lv/v1/editor/template/recent_list | 1 | 2195 | json |
| 187 | POST edit-api-sg.capcut.com /cc/v1/workspace/web/get_brand_list | 2 | 2197, 2224 | json |
| 188 | POST edit-api-sg.capcut.com /lv/v1/cc_web/plane/get_collection_templates | 1 | 2199 | json |
| 189 | POST edit-api-sg.capcut.com /lv/v2/editor/effect/recent_list | 3 | 2201, 2248, 2249 | json |
| 190 | GET lf16-beecdn.ibytedtos.com /obj/ies-fe-bee-sg/bee_prod/{ref-2a72b1445277213886}/bee_prod_49_bee_publish_709.json | 1 | 2209 | json |
| 191 | OPTIONS edit-api-sg.capcut.com /artist/v1/effect/get_search_words | 4 | 2213, 2214, 2216, 2217 | empty |
| 192 | POST edit-api-sg.capcut.com /artist/v1/effect/get_search_words | 4 | 2226, 2227, 2247, 2251 | json |
| 193 | GET content-autofill.googleapis.com /v1/pages/{ref-1bc64aad6a8fefdfd8} | 1 | 2254 | binary |
| 194 | OPTIONS edit-api-sg.capcut.com /artist/v1/effect/mget_item | 30 | 2259, 2260, 2261, 2262, 2263, 2264, 2265, 2267, 2268, 2269, 2270, 2271, 2272, 2273, 2274, 2275, 2276, 2277, 2278, 2279, 2280, 2281, 2282, 2283, 2284, 2285, 2286, 2287, 2288, 2289 | empty |
| 195 | POST edit-api-sg.capcut.com /artist/v1/effect/mget_item | 30 | 2291, 2294, 2295, 2296, 2297, 2298, 2318, 2319, 2320, 2322, 2323, 2324, 2325, 2327, 2328, 2329, 2330, 2331, 2332, 2333, 2334, 2335, 2336, 2337, 2338, 2339, 2341, 2342, 2343, 2358 | json |
| 196 | GET content-autofill.googleapis.com /v1/pages/{ref-0b89382384c3883d72} | 1 | 2359 | binary |
| 197 | OPTIONS edit-api-sg.capcut.com /cc/v1/workspace/sync_file_open_time | 1 | 2428 | empty |
| 198 | GET lf16-beecdn.ibytedtos.com /obj/ies-fe-bee-sg/bee_prod/{ref-f7a539f4bbd738a38a}/bee_prod_149_bee_publish_1284.json | 1 | 2435 | json |
| 199 | POST edit-api-sg.capcut.com /cc/v1/workspace/sync_file_open_time | 1 | 2440 | json |
| 200 | OPTIONS mcs-normal-sg.capcutapi.com /v1/user/webid | 1 | 2467 | empty |
| 201 | POST mcs-normal-sg.capcutapi.com /v1/user/webid | 1 | 2468 | json |
| 202 | OPTIONS imagex-normal-sg.capcutapi.com / | 4 | 2469, 2476, 2544, 2652 | empty |
| 203 | OPTIONS mcs-normal-sg.capcutapi.com /v1/list | 1 | 2470 | empty |
| 204 | POST mcs-normal-sg.capcutapi.com /v1/list | 16 | 2471, 2473, 2477, 2480, 2510, 2514, 2526, 2528, 2545, 2548, 2552, 2554, 2653, 2655, 2659, 2662 | json |
| 205 | GET imagex-normal-sg.capcutapi.com / | 3 | 2472, 2547, 2654 | json |
| 206 | POST imagex-normal-sg.capcutapi.com / | 3 | 2478, 2551, 2658 | json |
| 207 | GET www.capcut.com /static-resource/ies/ccweb/scm_storage/sdk/ever_cloud_sdk/{ref-6519583d44040b65a7}/web_streaming_md5.wasm | 1 | 2502 | binary |
| 208 | GET www.capcut.com /ai-creator/studio | 1 | 2666 | html |
| 209 | GET www.googletagmanager.com /ns.html | 2 | 2668, 2980 | html |
| 210 | OPTIONS edit-api-sg.capcut.com /service/settings/v3/ | 1 | 2690 | empty |
| 211 | GET edit-api-sg.capcut.com /service/settings/v3/ | 2 | 2708, 2992 | json |
| 212 | GET content-autofill.googleapis.com /v1/pages/{ref-ec8db731bbba6dab99} | 1 | 2765 | binary |
| 213 | GET content-autofill.googleapis.com /v1/pages/{ref-09382a6ab86feda69f} | 1 | 2781 | binary |
| 214 | OPTIONS edit-api-sg.capcut.com /lv/v1/user/web/authorized_user_info | 1 | 2797 | empty |
| 215 | POST edit-api-sg.capcut.com /lv/v1/user/web/authorized_user_info | 2 | 2802, 2994 | json |
| 216 | OPTIONS feed-api-sg.capcutapi.com /survey/api/feelgood/v1/token | 2 | 2817, 2998 | empty |
| 217 | POST feed-api-sg.capcutapi.com /survey/api/feelgood/v1/token | 2 | 2820, 3020 | json |
| 218 | OPTIONS feed-api-sg.capcutapi.com /survey/api/feelgood/v1/event | 2 | 2822, 3043 | empty |
| 219 | POST feed-api-sg.capcutapi.com /survey/api/feelgood/v1/event | 2 | 2824, 3054 | json |
| 220 | GET content-autofill.googleapis.com /v1/pages/{ref-29d60f8a28d2e1de1e} | 1 | 2855 | binary |
| 221 | GET www.capcut.com /ai-creator/start | 1 | 2976 | html |
| 222 | GET lf16-beecdn.ibytedtos.com /obj/ies-fe-bee-sg/bee_prod/{ref-f7a539f4bbd738a38a}/bee_prod_149_bee_publish_1128.json | 1 | 3022 | json |
| 223 | GET www.capcut.com /static-resource/ies/lvweb/ai_creator_oversea_online/static/wasm/3264dcbf9a.module.wasm | 1 | 3038 | binary |
| 224 | GET www.capcut.com /static-resource/ies/lvweb/ai_creator_oversea_online/static/wasm/{ref-181370cc7053d042ae} | 1 | 3039 | binary |
| 225 | GET content-autofill.googleapis.com /v1/pages/{ref-63a1285415bfb4806f} | 1 | 3048 | binary |
| 226 | OPTIONS edit-api-sg.capcut.com /artist/v1/action/get_user_action_list | 1 | 3066 | empty |
| 227 | POST edit-api-sg.capcut.com /artist/v1/action/get_user_action_list | 1 | 3079 | json |
| 228 | GET starling-va.byteoversea.com /check_and_get_text/{ref-9eff28ebd19f39887a}/normal/pipo_checkout | 1 | 3188 | json |
| 229 | GET starling-va.byteoversea.com /check_and_get_text/{ref-9eff28ebd19f39887a}/normal/pipo_cashier_components | 1 | 3189 | json |
| 230 | GET starling-va.byteoversea.com /check_and_get_text/{ref-fb32294e4051b2f617}/normal/Marketing | 1 | 3190 | json |
| 231 | OPTIONS maliva-mcs.byteoversea.com /webid | 2 | 3191, 3192 | empty |
| 232 | OPTIONS ttwid-sg.byteoversea.com /ttwid/union/register/ | 2 | 3193, 3194 | empty |
| 233 | OPTIONS mon-va.byteoversea.com /monitor_web/settings/browser-settings | 3 | 3199, 3217, 3249 | json |
| 234 | POST ttwid-sg.byteoversea.com /ttwid/union/register/ | 2 | 3200, 3203 | json |
| 235 | POST maliva-mcs.byteoversea.com /webid | 2 | 3206, 3208 | json |
| 236 | OPTIONS maliva-mcs.byteoversea.com /list | 6 | 3216, 3220, 3226, 3227, 3228, 3243 | empty |
| 237 | GET mssdk-va.byteoversea.com /web/resource | 1 | 3218 | json |
| 238 | GET mon-va.byteoversea.com /monitor_web/settings/browser-settings | 3 | 3219, 3261, 3268 | json |
| 239 | GET content-autofill.googleapis.com /v1/pages/{ref-59f1cb01bdfcff56b6} | 1 | 3223 | binary |
| 240 | OPTIONS libraweb.tiktok.com /service/{ref-1256c71cf0d5700420}/abtest_config/ | 1 | 3242 | json |
| 241 | POST maliva-mcs.byteoversea.com /list | 14 | 3248, 3250, 3262, 3263, 3265, 3267, 3269, 3271, 3289, 3291, 3293, 3294, 3307, 3311 | json |
| 242 | POST libraweb.tiktok.com /service/{ref-1256c71cf0d5700420}/abtest_config/ | 1 | 3259 | json |
| 243 | OPTIONS mon-va.byteoversea.com /monitor_browser/collect/batch/ | 3 | 3264, 3273, 3284 | empty |
| 244 | POST mon-va.byteoversea.com /monitor_browser/collect/batch/ | 13 | 3270, 3275, 3280, 3283, 3285, 3295, 3296, 3298, 3299, 3312, 3313, 3314, 3315 | empty |
