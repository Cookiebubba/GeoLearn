/**
 * Curated country list used by every puzzle.
 *
 * Policy (so the maps stay current and neutral):
 * - All 193 UN member states, the two UN observer states (Vatican City, Palestine),
 *   plus Kosovo, Taiwan and Western Sahara, which appear on most modern world maps.
 * - A handful of large dependent territories that are needed to complete a
 *   continent's silhouette (Greenland, Puerto Rico, French Guiana, Falkland Islands,
 *   New Caledonia). They are labelled as territories.
 * - Boundaries follow the internationally recognised (UN) view: Crimea is part of
 *   Ukraine, the Golan Heights are part of Syria, Northern Cyprus is part of Cyprus,
 *   Somaliland is part of Somalia and Western Sahara is shown whole.
 * - Names follow current English short forms (Czechia, Türkiye, Eswatini, North
 *   Macedonia, Cabo Verde, Timor-Leste, Côte d'Ivoire, Myanmar).
 */

export type ContinentId =
  | 'africa'
  | 'asia'
  | 'europe'
  | 'north-america'
  | 'south-america'
  | 'oceania';

export type CountryStatus = 'un-member' | 'observer' | 'partially-recognized' | 'disputed' | 'territory';

export interface CountryInfo {
  /** ISO 3166-1 alpha-3 (XKX for Kosovo). */
  id: string;
  /** Lowercase ISO 3166-1 alpha-2, used for flags. */
  iso2: string;
  name: string;
  capital: string | null;
  /** [longitude, latitude] */
  capitalLonLat: [number, number] | null;
  capitalNote?: string;
  status: CountryStatus;
  /** For territories: the governing country. */
  sovereign?: string;
  continents: ContinentId[];
  altNames?: string[];
}

type Row = [
  id: string,
  iso2: string,
  name: string,
  capital: string | null,
  lon: number | null,
  lat: number | null,
  continents: ContinentId[],
  extra?: Partial<Pick<CountryInfo, 'capitalNote' | 'status' | 'sovereign' | 'altNames'>>,
];

const AF: ContinentId[] = ['africa'];
const AS: ContinentId[] = ['asia'];
const EU: ContinentId[] = ['europe'];
const NA: ContinentId[] = ['north-america'];
const SA: ContinentId[] = ['south-america'];
const OC: ContinentId[] = ['oceania'];
const EUAS: ContinentId[] = ['europe', 'asia'];

const ROWS: Row[] = [
  // ── Africa ──────────────────────────────────────────────────────────────
  ['DZA', 'dz', 'Algeria', 'Algiers', 3.0588, 36.7538, AF],
  ['AGO', 'ao', 'Angola', 'Luanda', 13.2344, -8.8383, AF],
  ['BEN', 'bj', 'Benin', 'Porto-Novo', 2.6166, 6.4969, AF, { capitalNote: 'Cotonou is the seat of government' }],
  ['BWA', 'bw', 'Botswana', 'Gaborone', 25.9086, -24.6282, AF],
  ['BFA', 'bf', 'Burkina Faso', 'Ouagadougou', -1.5197, 12.3714, AF],
  ['BDI', 'bi', 'Burundi', 'Gitega', 29.9246, -3.4271, AF, { capitalNote: 'Bujumbura is the economic capital' }],
  ['CPV', 'cv', 'Cabo Verde', 'Praia', -23.5087, 14.933, AF, { altNames: ['Cape Verde'] }],
  ['CMR', 'cm', 'Cameroon', 'Yaoundé', 11.5021, 3.848, AF],
  ['CAF', 'cf', 'Central African Republic', 'Bangui', 18.5582, 4.3947, AF],
  ['TCD', 'td', 'Chad', "N'Djamena", 15.0444, 12.1348, AF],
  ['COM', 'km', 'Comoros', 'Moroni', 43.2551, -11.7172, AF],
  ['COG', 'cg', 'Congo', 'Brazzaville', 15.2663, -4.2634, AF, { altNames: ['Republic of the Congo'] }],
  ['COD', 'cd', 'DR Congo', 'Kinshasa', 15.2663, -4.4419, AF, { altNames: ['Democratic Republic of the Congo'] }],
  ['CIV', 'ci', "Côte d'Ivoire", 'Yamoussoukro', -5.2767, 6.8276, AF, { capitalNote: 'Abidjan is the economic capital', altNames: ['Ivory Coast'] }],
  ['DJI', 'dj', 'Djibouti', 'Djibouti', 43.145, 11.5721, AF],
  ['EGY', 'eg', 'Egypt', 'Cairo', 31.2357, 30.0444, AF],
  ['GNQ', 'gq', 'Equatorial Guinea', 'Malabo', 8.7832, 3.7504, AF],
  ['ERI', 'er', 'Eritrea', 'Asmara', 38.9251, 15.3229, AF],
  ['SWZ', 'sz', 'Eswatini', 'Mbabane', 31.1367, -26.3054, AF, { capitalNote: 'Lobamba is the royal and legislative capital', altNames: ['Swaziland'] }],
  ['ETH', 'et', 'Ethiopia', 'Addis Ababa', 38.7578, 9.0054, AF],
  ['GAB', 'ga', 'Gabon', 'Libreville', 9.4673, 0.4162, AF],
  ['GMB', 'gm', 'Gambia', 'Banjul', -16.5775, 13.4549, AF, { altNames: ['The Gambia'] }],
  ['GHA', 'gh', 'Ghana', 'Accra', -0.187, 5.6037, AF],
  ['GIN', 'gn', 'Guinea', 'Conakry', -13.6773, 9.6412, AF],
  ['GNB', 'gw', 'Guinea-Bissau', 'Bissau', -15.5977, 11.8817, AF],
  ['KEN', 'ke', 'Kenya', 'Nairobi', 36.8219, -1.2921, AF],
  ['LSO', 'ls', 'Lesotho', 'Maseru', 27.4869, -29.3151, AF],
  ['LBR', 'lr', 'Liberia', 'Monrovia', -10.8047, 6.3156, AF],
  ['LBY', 'ly', 'Libya', 'Tripoli', 13.1913, 32.8872, AF],
  ['MDG', 'mg', 'Madagascar', 'Antananarivo', 47.5079, -18.8792, AF],
  ['MWI', 'mw', 'Malawi', 'Lilongwe', 33.7741, -13.9626, AF],
  ['MLI', 'ml', 'Mali', 'Bamako', -8.0029, 12.6392, AF],
  ['MRT', 'mr', 'Mauritania', 'Nouakchott', -15.9582, 18.0735, AF],
  ['MUS', 'mu', 'Mauritius', 'Port Louis', 57.5012, -20.1609, AF],
  ['MAR', 'ma', 'Morocco', 'Rabat', -6.8498, 33.9716, AF],
  ['MOZ', 'mz', 'Mozambique', 'Maputo', 32.5732, -25.9692, AF],
  ['NAM', 'na', 'Namibia', 'Windhoek', 17.0658, -22.5609, AF],
  ['NER', 'ne', 'Niger', 'Niamey', 2.1254, 13.5116, AF],
  ['NGA', 'ng', 'Nigeria', 'Abuja', 7.3986, 9.0765, AF],
  ['RWA', 'rw', 'Rwanda', 'Kigali', 30.0619, -1.9441, AF],
  ['STP', 'st', 'São Tomé and Príncipe', 'São Tomé', 6.7273, 0.3365, AF],
  ['SEN', 'sn', 'Senegal', 'Dakar', -17.4677, 14.7167, AF],
  ['SYC', 'sc', 'Seychelles', 'Victoria', 55.4513, -4.6191, AF],
  ['SLE', 'sl', 'Sierra Leone', 'Freetown', -13.2317, 8.4657, AF],
  ['SOM', 'so', 'Somalia', 'Mogadishu', 45.3182, 2.0469, AF],
  ['ZAF', 'za', 'South Africa', 'Pretoria', 28.1881, -25.7461, AF, { capitalNote: 'Cape Town is the legislative capital and Bloemfontein the judicial capital' }],
  ['SSD', 'ss', 'South Sudan', 'Juba', 31.5825, 4.8594, AF],
  ['SDN', 'sd', 'Sudan', 'Khartoum', 32.5599, 15.5007, AF],
  ['TZA', 'tz', 'Tanzania', 'Dodoma', 35.7516, -6.163, AF, { capitalNote: 'Dar es Salaam is the largest city' }],
  ['TGO', 'tg', 'Togo', 'Lomé', 1.2255, 6.1256, AF],
  ['TUN', 'tn', 'Tunisia', 'Tunis', 10.1815, 36.8065, AF],
  ['UGA', 'ug', 'Uganda', 'Kampala', 32.5825, 0.3476, AF],
  ['ZMB', 'zm', 'Zambia', 'Lusaka', 28.3228, -15.3875, AF],
  ['ZWE', 'zw', 'Zimbabwe', 'Harare', 31.0492, -17.8252, AF],
  ['ESH', 'eh', 'Western Sahara', 'Laayoune', -13.1994, 27.1253, AF, { status: 'disputed', capitalNote: 'Disputed territory; Laayoune is the largest city' }],

  // ── Europe ──────────────────────────────────────────────────────────────
  ['ALB', 'al', 'Albania', 'Tirana', 19.8187, 41.3275, EU],
  ['AND', 'ad', 'Andorra', 'Andorra la Vella', 1.5218, 42.5063, EU],
  ['AUT', 'at', 'Austria', 'Vienna', 16.3738, 48.2082, EU],
  ['BLR', 'by', 'Belarus', 'Minsk', 27.5615, 53.9045, EU],
  ['BEL', 'be', 'Belgium', 'Brussels', 4.3517, 50.8503, EU],
  ['BIH', 'ba', 'Bosnia and Herzegovina', 'Sarajevo', 18.4131, 43.8563, EU],
  ['BGR', 'bg', 'Bulgaria', 'Sofia', 23.3219, 42.6977, EU],
  ['HRV', 'hr', 'Croatia', 'Zagreb', 15.9819, 45.815, EU],
  ['CYP', 'cy', 'Cyprus', 'Nicosia', 33.3823, 35.1856, EUAS],
  ['CZE', 'cz', 'Czechia', 'Prague', 14.4378, 50.0755, EU, { altNames: ['Czech Republic'] }],
  ['DNK', 'dk', 'Denmark', 'Copenhagen', 12.5683, 55.6761, EU],
  ['EST', 'ee', 'Estonia', 'Tallinn', 24.7536, 59.437, EU],
  ['FIN', 'fi', 'Finland', 'Helsinki', 24.9384, 60.1699, EU],
  ['FRA', 'fr', 'France', 'Paris', 2.3522, 48.8566, EU],
  ['DEU', 'de', 'Germany', 'Berlin', 13.405, 52.52, EU],
  ['GRC', 'gr', 'Greece', 'Athens', 23.7275, 37.9838, EU],
  ['HUN', 'hu', 'Hungary', 'Budapest', 19.0402, 47.4979, EU],
  ['ISL', 'is', 'Iceland', 'Reykjavík', -21.9426, 64.1466, EU],
  ['IRL', 'ie', 'Ireland', 'Dublin', -6.2603, 53.3498, EU],
  ['ITA', 'it', 'Italy', 'Rome', 12.4964, 41.9028, EU],
  ['XKX', 'xk', 'Kosovo', 'Pristina', 21.1655, 42.6629, EU, { status: 'partially-recognized' }],
  ['LVA', 'lv', 'Latvia', 'Riga', 24.1052, 56.9496, EU],
  ['LIE', 'li', 'Liechtenstein', 'Vaduz', 9.5209, 47.141, EU],
  ['LTU', 'lt', 'Lithuania', 'Vilnius', 25.2797, 54.6872, EU],
  ['LUX', 'lu', 'Luxembourg', 'Luxembourg', 6.1296, 49.6116, EU],
  ['MLT', 'mt', 'Malta', 'Valletta', 14.5146, 35.8989, EU],
  ['MDA', 'md', 'Moldova', 'Chișinău', 28.8638, 47.0105, EU],
  ['MCO', 'mc', 'Monaco', 'Monaco', 7.4246, 43.7384, EU],
  ['MNE', 'me', 'Montenegro', 'Podgorica', 19.2594, 42.4304, EU],
  ['NLD', 'nl', 'Netherlands', 'Amsterdam', 4.9041, 52.3676, EU, { capitalNote: 'The Hague is the seat of government' }],
  ['MKD', 'mk', 'North Macedonia', 'Skopje', 21.4254, 41.9981, EU],
  ['NOR', 'no', 'Norway', 'Oslo', 10.7522, 59.9139, EU],
  ['POL', 'pl', 'Poland', 'Warsaw', 21.0122, 52.2297, EU],
  ['PRT', 'pt', 'Portugal', 'Lisbon', -9.1393, 38.7223, EU],
  ['ROU', 'ro', 'Romania', 'Bucharest', 26.1025, 44.4268, EU],
  ['RUS', 'ru', 'Russia', 'Moscow', 37.6173, 55.7558, EUAS],
  ['SMR', 'sm', 'San Marino', 'San Marino', 12.4468, 43.936, EU],
  ['SRB', 'rs', 'Serbia', 'Belgrade', 20.4489, 44.7866, EU],
  ['SVK', 'sk', 'Slovakia', 'Bratislava', 17.1077, 48.1486, EU],
  ['SVN', 'si', 'Slovenia', 'Ljubljana', 14.5058, 46.0569, EU],
  ['ESP', 'es', 'Spain', 'Madrid', -3.7038, 40.4168, EU],
  ['SWE', 'se', 'Sweden', 'Stockholm', 18.0686, 59.3293, EU],
  ['CHE', 'ch', 'Switzerland', 'Bern', 7.4474, 46.948, EU],
  ['TUR', 'tr', 'Türkiye', 'Ankara', 32.8597, 39.9334, EUAS, { altNames: ['Turkey'] }],
  ['UKR', 'ua', 'Ukraine', 'Kyiv', 30.5234, 50.4501, EU],
  ['GBR', 'gb', 'United Kingdom', 'London', -0.1276, 51.5072, EU],
  ['VAT', 'va', 'Vatican City', 'Vatican City', 12.4534, 41.9029, EU, { status: 'observer', altNames: ['Holy See'] }],
  ['GEO', 'ge', 'Georgia', 'Tbilisi', 44.7833, 41.7151, EUAS],
  ['ARM', 'am', 'Armenia', 'Yerevan', 44.5152, 40.1872, EUAS],
  ['AZE', 'az', 'Azerbaijan', 'Baku', 49.8671, 40.4093, EUAS],

  // ── Asia ────────────────────────────────────────────────────────────────
  ['AFG', 'af', 'Afghanistan', 'Kabul', 69.2075, 34.5553, AS],
  ['BHR', 'bh', 'Bahrain', 'Manama', 50.5861, 26.2285, AS],
  ['BGD', 'bd', 'Bangladesh', 'Dhaka', 90.4125, 23.8103, AS],
  ['BTN', 'bt', 'Bhutan', 'Thimphu', 89.639, 27.4728, AS],
  ['BRN', 'bn', 'Brunei', 'Bandar Seri Begawan', 114.9398, 4.9031, AS],
  ['KHM', 'kh', 'Cambodia', 'Phnom Penh', 104.9282, 11.5564, AS],
  ['CHN', 'cn', 'China', 'Beijing', 116.4074, 39.9042, AS],
  ['IND', 'in', 'India', 'New Delhi', 77.209, 28.6139, AS],
  ['IDN', 'id', 'Indonesia', 'Jakarta', 106.8456, -6.2088, AS, { capitalNote: 'Nusantara is the designated future capital' }],
  ['IRN', 'ir', 'Iran', 'Tehran', 51.389, 35.6892, AS],
  ['IRQ', 'iq', 'Iraq', 'Baghdad', 44.3661, 33.3152, AS],
  ['ISR', 'il', 'Israel', 'Jerusalem', 35.2137, 31.7683, AS, { capitalNote: "Jerusalem's status is disputed; most embassies are in Tel Aviv" }],
  ['JPN', 'jp', 'Japan', 'Tokyo', 139.6917, 35.6895, AS],
  ['JOR', 'jo', 'Jordan', 'Amman', 35.9106, 31.9539, AS],
  ['KAZ', 'kz', 'Kazakhstan', 'Astana', 71.4491, 51.1694, AS],
  ['KWT', 'kw', 'Kuwait', 'Kuwait City', 47.9774, 29.3759, AS],
  ['KGZ', 'kg', 'Kyrgyzstan', 'Bishkek', 74.5698, 42.8746, AS],
  ['LAO', 'la', 'Laos', 'Vientiane', 102.6331, 17.9757, AS],
  ['LBN', 'lb', 'Lebanon', 'Beirut', 35.5018, 33.8938, AS],
  ['MYS', 'my', 'Malaysia', 'Kuala Lumpur', 101.6869, 3.139, AS, { capitalNote: 'Putrajaya is the administrative centre' }],
  ['MDV', 'mv', 'Maldives', 'Malé', 73.5093, 4.1755, AS],
  ['MNG', 'mn', 'Mongolia', 'Ulaanbaatar', 106.9057, 47.8864, AS],
  ['MMR', 'mm', 'Myanmar', 'Naypyidaw', 96.1297, 19.7633, AS, { altNames: ['Burma'] }],
  ['NPL', 'np', 'Nepal', 'Kathmandu', 85.324, 27.7172, AS],
  ['PRK', 'kp', 'North Korea', 'Pyongyang', 125.7625, 39.0392, AS],
  ['OMN', 'om', 'Oman', 'Muscat', 58.4059, 23.588, AS],
  ['PAK', 'pk', 'Pakistan', 'Islamabad', 73.0479, 33.6844, AS],
  ['PSE', 'ps', 'Palestine', 'Ramallah', 35.2044, 31.9038, AS, { status: 'observer', capitalNote: 'Administrative centre; East Jerusalem is the proclaimed capital' }],
  ['PHL', 'ph', 'Philippines', 'Manila', 120.9842, 14.5995, AS],
  ['QAT', 'qa', 'Qatar', 'Doha', 51.531, 25.2854, AS],
  ['SAU', 'sa', 'Saudi Arabia', 'Riyadh', 46.6753, 24.7136, AS],
  ['SGP', 'sg', 'Singapore', 'Singapore', 103.8519, 1.2903, AS],
  ['KOR', 'kr', 'South Korea', 'Seoul', 126.978, 37.5665, AS],
  ['LKA', 'lk', 'Sri Lanka', 'Sri Jayawardenepura Kotte', 79.9072, 6.8905, AS, { capitalNote: 'Colombo is the commercial capital' }],
  ['SYR', 'sy', 'Syria', 'Damascus', 36.2765, 33.5138, AS],
  ['TWN', 'tw', 'Taiwan', 'Taipei', 121.5654, 25.033, AS, { status: 'partially-recognized' }],
  ['TJK', 'tj', 'Tajikistan', 'Dushanbe', 68.7791, 38.5598, AS],
  ['THA', 'th', 'Thailand', 'Bangkok', 100.5018, 13.7563, AS],
  ['TLS', 'tl', 'Timor-Leste', 'Dili', 125.5603, -8.5569, AS, { altNames: ['East Timor'] }],
  ['TKM', 'tm', 'Turkmenistan', 'Ashgabat', 58.3833, 37.95, AS],
  ['ARE', 'ae', 'United Arab Emirates', 'Abu Dhabi', 54.3773, 24.4539, AS],
  ['UZB', 'uz', 'Uzbekistan', 'Tashkent', 69.2401, 41.2995, AS],
  ['VNM', 'vn', 'Vietnam', 'Hanoi', 105.8342, 21.0278, AS],
  ['YEM', 'ye', 'Yemen', "Sana'a", 44.191, 15.3694, AS],

  // ── North America ───────────────────────────────────────────────────────
  ['ATG', 'ag', 'Antigua and Barbuda', "Saint John's", -61.8456, 17.1274, NA],
  ['BHS', 'bs', 'Bahamas', 'Nassau', -77.3554, 25.0443, NA, { altNames: ['The Bahamas'] }],
  ['BRB', 'bb', 'Barbados', 'Bridgetown', -59.6167, 13.0969, NA],
  ['BLZ', 'bz', 'Belize', 'Belmopan', -88.7671, 17.252, NA],
  ['CAN', 'ca', 'Canada', 'Ottawa', -75.6972, 45.4215, NA],
  ['CRI', 'cr', 'Costa Rica', 'San José', -84.0907, 9.9281, NA],
  ['CUB', 'cu', 'Cuba', 'Havana', -82.3666, 23.1136, NA],
  ['DMA', 'dm', 'Dominica', 'Roseau', -61.3794, 15.3092, NA],
  ['DOM', 'do', 'Dominican Republic', 'Santo Domingo', -69.9312, 18.4861, NA],
  ['SLV', 'sv', 'El Salvador', 'San Salvador', -89.2182, 13.6929, NA],
  ['GRD', 'gd', 'Grenada', "Saint George's", -61.7486, 12.0561, NA],
  ['GTM', 'gt', 'Guatemala', 'Guatemala City', -90.5069, 14.6349, NA],
  ['HTI', 'ht', 'Haiti', 'Port-au-Prince', -72.3388, 18.5944, NA],
  ['HND', 'hn', 'Honduras', 'Tegucigalpa', -87.2068, 14.0723, NA],
  ['JAM', 'jm', 'Jamaica', 'Kingston', -76.7936, 17.9712, NA],
  ['MEX', 'mx', 'Mexico', 'Mexico City', -99.1332, 19.4326, NA],
  ['NIC', 'ni', 'Nicaragua', 'Managua', -86.2514, 12.1364, NA],
  ['PAN', 'pa', 'Panama', 'Panama City', -79.5199, 8.9824, NA],
  ['KNA', 'kn', 'Saint Kitts and Nevis', 'Basseterre', -62.7177, 17.3026, NA],
  ['LCA', 'lc', 'Saint Lucia', 'Castries', -60.9875, 14.0101, NA],
  ['VCT', 'vc', 'Saint Vincent and the Grenadines', 'Kingstown', -61.2248, 13.1587, NA],
  ['TTO', 'tt', 'Trinidad and Tobago', 'Port of Spain', -61.5189, 10.6603, NA],
  ['USA', 'us', 'United States', 'Washington, D.C.', -77.0369, 38.9072, NA, { altNames: ['United States of America', 'USA'] }],
  ['GRL', 'gl', 'Greenland', 'Nuuk', -51.7216, 64.1814, NA, { status: 'territory', sovereign: 'Denmark' }],
  ['PRI', 'pr', 'Puerto Rico', 'San Juan', -66.1057, 18.4655, NA, { status: 'territory', sovereign: 'United States' }],

  // ── South America ───────────────────────────────────────────────────────
  ['ARG', 'ar', 'Argentina', 'Buenos Aires', -58.3816, -34.6037, SA],
  ['BOL', 'bo', 'Bolivia', 'Sucre', -65.2627, -19.0196, SA, { capitalNote: 'La Paz is the seat of government' }],
  ['BRA', 'br', 'Brazil', 'Brasília', -47.8825, -15.7942, SA],
  ['CHL', 'cl', 'Chile', 'Santiago', -70.6693, -33.4489, SA],
  ['COL', 'co', 'Colombia', 'Bogotá', -74.0721, 4.711, SA],
  ['ECU', 'ec', 'Ecuador', 'Quito', -78.4678, -0.1807, SA],
  ['GUY', 'gy', 'Guyana', 'Georgetown', -58.1553, 6.8013, SA],
  ['PRY', 'py', 'Paraguay', 'Asunción', -57.5759, -25.2637, SA],
  ['PER', 'pe', 'Peru', 'Lima', -77.0428, -12.0464, SA],
  ['SUR', 'sr', 'Suriname', 'Paramaribo', -55.2038, 5.852, SA],
  ['URY', 'uy', 'Uruguay', 'Montevideo', -56.1645, -34.9011, SA],
  ['VEN', 've', 'Venezuela', 'Caracas', -66.9036, 10.4806, SA],
  ['GUF', 'gf', 'French Guiana', 'Cayenne', -52.3135, 4.9224, SA, { status: 'territory', sovereign: 'France' }],
  ['FLK', 'fk', 'Falkland Islands', 'Stanley', -57.8517, -51.6977, SA, { status: 'territory', sovereign: 'United Kingdom', capitalNote: 'Also claimed by Argentina' }],

  // ── Oceania ─────────────────────────────────────────────────────────────
  ['AUS', 'au', 'Australia', 'Canberra', 149.13, -35.2809, OC],
  ['FJI', 'fj', 'Fiji', 'Suva', 178.4419, -18.1416, OC],
  ['KIR', 'ki', 'Kiribati', 'South Tarawa', 173.0176, 1.3382, OC],
  ['MHL', 'mh', 'Marshall Islands', 'Majuro', 171.3803, 7.0897, OC],
  ['FSM', 'fm', 'Micronesia', 'Palikir', 158.1618, 6.9248, OC],
  ['NRU', 'nr', 'Nauru', 'Yaren', 166.9209, -0.5477, OC, { capitalNote: 'Nauru has no official capital; government offices are in Yaren' }],
  ['NZL', 'nz', 'New Zealand', 'Wellington', 174.7762, -41.2865, OC],
  ['PLW', 'pw', 'Palau', 'Ngerulmud', 134.6242, 7.5006, OC],
  ['PNG', 'pg', 'Papua New Guinea', 'Port Moresby', 147.1803, -9.4438, OC],
  ['WSM', 'ws', 'Samoa', 'Apia', -171.7514, -13.8333, OC],
  ['SLB', 'sb', 'Solomon Islands', 'Honiara', 159.9729, -9.4456, OC],
  ['TON', 'to', 'Tonga', 'Nukuʻalofa', -175.2018, -21.1394, OC],
  ['TUV', 'tv', 'Tuvalu', 'Funafuti', 179.1942, -8.5211, OC],
  ['VUT', 'vu', 'Vanuatu', 'Port Vila', 168.3273, -17.7334, OC],
  ['NCL', 'nc', 'New Caledonia', 'Nouméa', 166.4572, -22.2758, OC, { status: 'territory', sovereign: 'France' }],
];

export const COUNTRIES: CountryInfo[] = ROWS.map(([id, iso2, name, capital, lon, lat, continents, extra]) => ({
  id,
  iso2,
  name,
  capital,
  capitalLonLat: lon === null || lat === null ? null : [lon, lat],
  status: extra?.status ?? 'un-member',
  continents,
  ...(extra?.capitalNote ? { capitalNote: extra.capitalNote } : {}),
  ...(extra?.sovereign ? { sovereign: extra.sovereign } : {}),
  ...(extra?.altNames ? { altNames: extra.altNames } : {}),
}));

export const COUNTRY_BY_ID: ReadonlyMap<string, CountryInfo> = new Map(COUNTRIES.map((c) => [c.id, c]));
