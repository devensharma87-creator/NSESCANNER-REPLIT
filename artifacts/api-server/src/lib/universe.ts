// Curated NSE universe across major sectors.
// Symbol is the NSE ticker (no .NS suffix); Yahoo Finance accessed as `${symbol}.NS`.
export interface UniverseEntry {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  description: string;
  seasonality?: string;
  catalysts?: string[];
}

export const UNIVERSE: UniverseEntry[] = [
  // Banking & Financials
  { symbol: "HDFCBANK", name: "HDFC Bank", sector: "Banking", industry: "Private Bank", description: "India's largest private sector bank by assets, offering retail and corporate banking, loans, credit cards and digital banking services.", seasonality: "Festive season credit growth Q3; year-end retail loan push Q4.", catalysts: ["RBI policy rate decisions", "Quarterly NIM and slippage", "Credit growth vs deposit growth"] },
  { symbol: "ICICIBANK", name: "ICICI Bank", sector: "Banking", industry: "Private Bank", description: "Second-largest private bank in India with strong retail franchise, digital banking and subsidiaries in life insurance, AMC and securities.", catalysts: ["Asset quality trends", "Subsidiary value unlocking", "Retail loan growth"] },
  { symbol: "SBIN", name: "State Bank of India", sector: "Banking", industry: "Public Bank", description: "India's largest public sector bank with dominant deposit franchise and pan-India network.", catalysts: ["PSU bank reforms", "Treasury gains in falling rate cycle", "Asset quality improvement"] },
  { symbol: "AXISBANK", name: "Axis Bank", sector: "Banking", industry: "Private Bank", description: "Third-largest private bank in India with focus on retail banking and SME lending.", catalysts: ["NIM expansion", "Credit cost normalization"] },
  { symbol: "KOTAKBANK", name: "Kotak Mahindra Bank", sector: "Banking", industry: "Private Bank", description: "Premium private bank with diversified financial services franchise.", catalysts: ["Succession & growth strategy", "Subsidiary monetization"] },
  { symbol: "INDUSINDBK", name: "IndusInd Bank", sector: "Banking", industry: "Private Bank", description: "Mid-sized private bank with strong vehicle finance and microfinance presence.", catalysts: ["MFI cycle", "Credit cost trajectory"] },
  { symbol: "BAJFINANCE", name: "Bajaj Finance", sector: "Financials", industry: "NBFC", description: "Leading consumer and SME lender; one of India's most valuable NBFCs.", catalysts: ["AUM growth rate", "Cost of funds", "Asset quality across consumer book"] },
  { symbol: "BAJAJFINSV", name: "Bajaj Finserv", sector: "Financials", industry: "Holding", description: "Holding company for Bajaj's lending, life insurance and general insurance businesses.", catalysts: ["Insurance growth", "Bajaj Finance performance"] },
  { symbol: "SBILIFE", name: "SBI Life Insurance", sector: "Financials", industry: "Life Insurance", description: "One of India's largest private life insurers with bancassurance backbone via SBI.", catalysts: ["VNB margin", "APE growth"] },
  { symbol: "HDFCLIFE", name: "HDFC Life Insurance", sector: "Financials", industry: "Life Insurance", description: "Top private life insurer with strong protection and ULIP franchise.", catalysts: ["Product mix shift", "Persistency"] },
  { symbol: "ICICIPRULI", name: "ICICI Prudential Life", sector: "Financials", industry: "Life Insurance", description: "Major private life insurer with diversified product mix.", catalysts: ["VNB margin", "Channel mix"] },
  { symbol: "CHOLAFIN", name: "Cholamandalam Finance", sector: "Financials", industry: "NBFC", description: "Diversified NBFC with vehicle finance, home loans and SME lending.", catalysts: ["Vehicle finance cycle", "Asset quality"] },

  // IT
  { symbol: "TCS", name: "Tata Consultancy Services", sector: "IT", industry: "IT Services", description: "India's largest IT services company providing consulting, technology and BPO services globally.", seasonality: "Q1 (Apr-Jun) typically strongest; furloughs in Q3 (Oct-Dec).", catalysts: ["BFSI client spending", "Deal TCV", "USD-INR movement"] },
  { symbol: "INFY", name: "Infosys", sector: "IT", industry: "IT Services", description: "Global IT consulting and services major with strong digital and cloud transformation practice.", catalysts: ["Large deal wins", "Margin trajectory", "FY guidance"] },
  { symbol: "WIPRO", name: "Wipro", sector: "IT", industry: "IT Services", description: "Global IT services company in transformation phase with focus on consulting and cloud.", catalysts: ["Capco synergies", "Margin recovery"] },
  { symbol: "HCLTECH", name: "HCL Technologies", sector: "IT", industry: "IT Services", description: "Major IT services firm with strong infrastructure management and engineering services.", catalysts: ["ER&D growth", "Software products"] },
  { symbol: "TECHM", name: "Tech Mahindra", sector: "IT", industry: "IT Services", description: "IT services firm with telecom vertical strength and 5G/network services exposure.", catalysts: ["Telecom capex cycle", "Margin recovery"] },
  { symbol: "LTIM", name: "LTIMindtree", sector: "IT", industry: "IT Services", description: "Mid-tier IT services firm formed from L&T Infotech and Mindtree merger.", catalysts: ["Synergy benefits", "BFSI exposure"] },
  { symbol: "PERSISTENT", name: "Persistent Systems", sector: "IT", industry: "IT Services", description: "Mid-cap IT services firm with strong digital engineering practice.", catalysts: ["Product engineering deals", "Hi-tech vertical"] },
  { symbol: "COFORGE", name: "Coforge", sector: "IT", industry: "IT Services", description: "Mid-cap IT services with focus on travel, BFSI and insurance verticals.", catalysts: ["BFSI deals", "Travel recovery"] },

  // Energy & Oil
  { symbol: "RELIANCE", name: "Reliance Industries", sector: "Energy", industry: "Oil & Gas / Conglomerate", description: "Diversified conglomerate spanning oil-to-chemicals, telecom (Jio), retail and new energy.", catalysts: ["Jio ARPU & subscriber growth", "Retail expansion", "New energy capex", "Refining margins"] },
  { symbol: "ONGC", name: "Oil and Natural Gas Corp", sector: "Energy", industry: "Upstream Oil & Gas", description: "India's largest upstream oil & gas explorer and producer.", catalysts: ["Crude oil prices", "Production growth", "Government windfall tax"] },
  { symbol: "IOC", name: "Indian Oil Corp", sector: "Energy", industry: "Oil Refining & Marketing", description: "Largest oil refining and marketing PSU in India.", catalysts: ["Refining margins (GRM)", "Marketing margins", "Crude prices"] },
  { symbol: "BPCL", name: "Bharat Petroleum", sector: "Energy", industry: "Oil Refining & Marketing", description: "Major oil refining and marketing PSU with petrochem expansion plans.", catalysts: ["Marketing margins", "Refinery upgradation"] },
  { symbol: "GAIL", name: "GAIL India", sector: "Energy", industry: "Natural Gas", description: "India's largest natural gas transmission and marketing company.", catalysts: ["Gas tariff revisions", "Petchem segment", "LNG spreads"] },
  { symbol: "POWERGRID", name: "Power Grid Corp", sector: "Energy", industry: "Power Transmission", description: "India's largest electric power transmission utility, primarily PSU.", catalysts: ["Capex execution", "Tariff orders"] },
  { symbol: "NTPC", name: "NTPC", sector: "Energy", industry: "Power Generation", description: "India's largest power producer with thermal and growing renewables portfolio.", catalysts: ["Renewable capacity additions", "PLF improvement"] },
  { symbol: "TATAPOWER", name: "Tata Power", sector: "Energy", industry: "Integrated Power", description: "Diversified power utility with growing renewables and EV charging business.", catalysts: ["Renewable additions", "EV charging rollout"] },
  { symbol: "ADANIGREEN", name: "Adani Green Energy", sector: "Energy", industry: "Renewables", description: "Pure-play renewable energy producer with large solar and wind capacity.", catalysts: ["Capacity additions", "PPA tariffs"] },

  // Auto
  { symbol: "MARUTI", name: "Maruti Suzuki", sector: "Auto", industry: "Passenger Vehicles", description: "India's largest passenger car maker with dominant share in entry and mid segments.", seasonality: "Festive Q3 boost; weak monsoon = rural slowdown.", catalysts: ["SUV mix improvement", "Hybrid/EV roadmap", "Rural demand"] },
  { symbol: "TATAMOTORS", name: "Tata Motors", sector: "Auto", industry: "Auto OEM", description: "Diversified automaker with PV/EV leadership in India and JLR luxury business globally.", catalysts: ["JLR margins", "EV market share", "CV cycle"] },
  { symbol: "M&M", name: "Mahindra & Mahindra", sector: "Auto", industry: "Auto OEM", description: "Leading SUV and tractor maker with tech-led EV and farm equipment franchise.", catalysts: ["SUV booking pipeline", "Tractor cycle"] },
  { symbol: "BAJAJ-AUTO", name: "Bajaj Auto", sector: "Auto", industry: "2W & 3W", description: "Major two-wheeler and three-wheeler maker with strong export franchise.", catalysts: ["Export recovery", "EV launches", "Premium 2W mix"] },
  { symbol: "HEROMOTOCO", name: "Hero MotoCorp", sector: "Auto", industry: "2W", description: "World's largest two-wheeler maker by volume with mass market dominance.", catalysts: ["Rural demand", "Premiumization", "EV transition"] },
  { symbol: "EICHERMOT", name: "Eicher Motors", sector: "Auto", industry: "2W & CV", description: "Owner of Royal Enfield premium motorcycles and VECV commercial vehicles JV.", catalysts: ["Royal Enfield exports", "New launches", "CV cycle"] },
  { symbol: "ASHOKLEY", name: "Ashok Leyland", sector: "Auto", industry: "Commercial Vehicles", description: "Second-largest CV maker in India with strong M&HCV franchise.", catalysts: ["CV cycle", "Defense orders"] },
  { symbol: "TVSMOTOR", name: "TVS Motor", sector: "Auto", industry: "2W & 3W", description: "Premium two-wheeler maker with strong scooter and motorcycle portfolio.", catalysts: ["Premium mix", "EV scooter ramp"] },

  // Pharma & Healthcare
  { symbol: "SUNPHARMA", name: "Sun Pharmaceutical", sector: "Pharma", industry: "Pharmaceuticals", description: "India's largest pharma company with strong specialty franchise in US and India.", catalysts: ["Specialty drug launches", "US generics pricing"] },
  { symbol: "DRREDDY", name: "Dr. Reddy's Laboratories", sector: "Pharma", industry: "Pharmaceuticals", description: "Major Indian pharma with US generics and emerging market presence.", catalysts: ["gRevlimid contribution", "Biosimilar pipeline"] },
  { symbol: "CIPLA", name: "Cipla", sector: "Pharma", industry: "Pharmaceuticals", description: "Diversified pharma with strength in respiratory, US generics and India branded business.", catalysts: ["US complex generics approvals", "India growth"] },
  { symbol: "DIVISLAB", name: "Divi's Laboratories", sector: "Pharma", industry: "Pharma APIs / Custom Synthesis", description: "Leading API and custom synthesis player serving global innovator pharma.", catalysts: ["Custom synthesis order book", "Capex utilization"] },
  { symbol: "APOLLOHOSP", name: "Apollo Hospitals", sector: "Pharma", industry: "Hospitals", description: "Largest hospital chain in India with growing pharmacy and digital health businesses.", catalysts: ["ARPOB improvement", "Apollo 24/7 growth"] },
  { symbol: "LUPIN", name: "Lupin", sector: "Pharma", industry: "Pharmaceuticals", description: "Major Indian pharma with US generics focus and complex injectables pipeline.", catalysts: ["gSpiriva and complex generics", "India growth"] },

  // FMCG
  { symbol: "HINDUNILVR", name: "Hindustan Unilever", sector: "FMCG", industry: "Consumer Staples", description: "India's largest FMCG company with home & personal care, foods and beverages portfolio.", seasonality: "Summer Q1 boost for personal care; winter Q3 for skin & foods.", catalysts: ["Rural demand recovery", "Premiumization", "Raw material costs"] },
  { symbol: "ITC", name: "ITC", sector: "FMCG", industry: "Conglomerate", description: "Diversified group with cigarettes, FMCG, hotels, paperboards and agri businesses.", catalysts: ["Cigarette tax stability", "FMCG margin expansion", "Hotels cycle"] },
  { symbol: "NESTLEIND", name: "Nestle India", sector: "FMCG", industry: "Packaged Foods", description: "Leading packaged foods company in India with strong infant nutrition and culinary brands.", catalysts: ["Volume growth", "Rural distribution"] },
  { symbol: "BRITANNIA", name: "Britannia Industries", sector: "FMCG", industry: "Biscuits & Foods", description: "Largest biscuit maker in India with adjacencies in dairy and bakery.", catalysts: ["Rural demand", "Input costs"] },
  { symbol: "DABUR", name: "Dabur India", sector: "FMCG", industry: "FMCG", description: "Ayurveda-led FMCG with hair care, healthcare and foods portfolio.", catalysts: ["Rural recovery", "International business"] },
  { symbol: "MARICO", name: "Marico", sector: "FMCG", industry: "FMCG", description: "Hair care and edible oils FMCG with growing premium personal care portfolio.", catalysts: ["Saffola growth", "Rural demand"] },
  { symbol: "TATACONSUM", name: "Tata Consumer Products", sector: "FMCG", industry: "Tea & Foods", description: "Global tea major and growing India foods business under Tata Group.", catalysts: ["Tea prices", "Foods scale-up"] },
  { symbol: "GODREJCP", name: "Godrej Consumer", sector: "FMCG", industry: "Home & Personal Care", description: "Home care and personal care FMCG with Indian and international presence.", catalysts: ["Indonesia turnaround", "India home care"] },

  // Metals & Mining
  { symbol: "TATASTEEL", name: "Tata Steel", sector: "Metals", industry: "Steel", description: "Major integrated steel producer with strong Indian operations and European exposure.", catalysts: ["Steel prices", "Coking coal cost", "Europe restructuring"] },
  { symbol: "JSWSTEEL", name: "JSW Steel", sector: "Metals", industry: "Steel", description: "Largest private steel producer in India with low-cost integrated operations.", catalysts: ["Capacity expansion", "Spreads"] },
  { symbol: "HINDALCO", name: "Hindalco Industries", sector: "Metals", industry: "Aluminium", description: "India's largest aluminium maker, also owns Novelis (largest aluminium rolled products globally).", catalysts: ["Aluminium prices", "Novelis margins"] },
  { symbol: "VEDL", name: "Vedanta", sector: "Metals", industry: "Diversified Metals", description: "Diversified natural resources company spanning zinc, aluminium, oil & gas and power.", catalysts: ["Metal prices", "Demerger plan", "Debt reduction"] },
  { symbol: "COALINDIA", name: "Coal India", sector: "Metals", industry: "Coal", description: "World's largest coal mining company; PSU monopoly in Indian thermal coal.", catalysts: ["Production growth", "E-auction premiums"] },
  { symbol: "JINDALSTEL", name: "Jindal Steel & Power", sector: "Metals", industry: "Steel", description: "Integrated steel producer with captive iron ore and coal mines.", catalysts: ["Capacity expansion", "Spreads"] },
  { symbol: "NMDC", name: "NMDC", sector: "Metals", industry: "Iron Ore Mining", description: "India's largest iron ore producer; PSU.", catalysts: ["Iron ore prices", "Production volumes"] },
  { symbol: "SAIL", name: "Steel Authority of India", sector: "Metals", industry: "Steel", description: "Largest steel producer in India by capacity; PSU.", catalysts: ["Steel prices", "Cost control"] },

  // Cement & Construction
  { symbol: "ULTRACEMCO", name: "UltraTech Cement", sector: "Cement", industry: "Cement", description: "India's largest cement producer (Aditya Birla Group) with pan-India presence.", catalysts: ["Cement prices", "Demand growth", "Cost levers"] },
  { symbol: "GRASIM", name: "Grasim Industries", sector: "Cement", industry: "Cement / Conglomerate", description: "Aditya Birla flagship with VSF, chemicals and UltraTech cement holding.", catalysts: ["Paints foray", "VSF margins"] },
  { symbol: "SHREECEM", name: "Shree Cement", sector: "Cement", industry: "Cement", description: "Low-cost north-India focused cement major with growing pan-India footprint.", catalysts: ["Cement prices", "Capacity additions"] },
  { symbol: "AMBUJACEM", name: "Ambuja Cements", sector: "Cement", industry: "Cement", description: "Major cement maker now part of Adani Group; targeting aggressive capacity expansion.", catalysts: ["Adani synergy", "Capex"] },
  { symbol: "ACC", name: "ACC", sector: "Cement", industry: "Cement", description: "One of India's oldest cement makers; part of Adani Group.", catalysts: ["Cost synergy", "Volumes"] },
  { symbol: "LT", name: "Larsen & Toubro", sector: "Construction", industry: "EPC / Engineering", description: "India's largest engineering and construction conglomerate with infrastructure, hydrocarbon and IT subsidiaries.", catalysts: ["Order inflows", "Middle East orders", "IT subsidiaries"] },

  // Telecom & Media
  { symbol: "BHARTIARTL", name: "Bharti Airtel", sector: "Telecom", industry: "Telecom Services", description: "India's second-largest telecom operator with growing African and enterprise franchise.", catalysts: ["ARPU hikes", "5G monetization", "Africa business"] },
  { symbol: "IDEA", name: "Vodafone Idea", sector: "Telecom", industry: "Telecom Services", description: "Third-largest Indian telecom operator with significant deleveraging needs.", catalysts: ["Capital raise", "Tariff hikes"] },
  { symbol: "ZEEL", name: "Zee Entertainment", sector: "Media", industry: "Media & Entertainment", description: "Major Indian broadcaster with TV and OTT (Zee5) presence.", catalysts: ["Ad revenue", "OTT growth"] },

  // Real Estate
  { symbol: "DLF", name: "DLF", sector: "Real Estate", industry: "Real Estate", description: "India's largest listed real estate developer with NCR residential and commercial focus.", catalysts: ["New launches", "Pre-sales bookings"] },
  { symbol: "GODREJPROP", name: "Godrej Properties", sector: "Real Estate", industry: "Real Estate", description: "Pan-India residential developer with asset-light JV-led model.", catalysts: ["Bookings growth", "Land acquisitions"] },
  { symbol: "OBEROIRLTY", name: "Oberoi Realty", sector: "Real Estate", industry: "Real Estate", description: "Premium Mumbai-focused residential and commercial developer.", catalysts: ["Mumbai luxury demand", "Project launches"] },
  { symbol: "PRESTIGE", name: "Prestige Estates", sector: "Real Estate", industry: "Real Estate", description: "South India-focused diversified real estate developer.", catalysts: ["Mumbai/NCR expansion", "Annuity portfolio"] },

  // Chemicals & Paints
  { symbol: "ASIANPAINT", name: "Asian Paints", sector: "Chemicals", industry: "Paints", description: "India's largest paint company with dominant decorative paints market share.", catalysts: ["Volume growth", "Crude derivative costs", "Competitive intensity"] },
  { symbol: "BERGEPAINT", name: "Berger Paints", sector: "Chemicals", industry: "Paints", description: "Second-largest paint company in India with strong industrial paints presence.", catalysts: ["Market share", "Margin recovery"] },
  { symbol: "PIDILITIND", name: "Pidilite Industries", sector: "Chemicals", industry: "Adhesives", description: "Dominant adhesives maker (Fevicol) with growing construction chemicals presence.", catalysts: ["Volume growth", "Input costs"] },
  { symbol: "SRF", name: "SRF", sector: "Chemicals", industry: "Specialty Chemicals", description: "Diversified chemicals firm with fluorochemicals, specialty chemicals and packaging films.", catalysts: ["Fluorochemicals cycle", "Capex commissioning"] },
  { symbol: "PIIND", name: "PI Industries", sector: "Chemicals", industry: "Agrochemicals", description: "Leading custom synthesis agrochemicals player with strong global innovator clientele.", catalysts: ["CSM order book", "Pharma diversification"] },
  { symbol: "UPL", name: "UPL", sector: "Chemicals", industry: "Agrochemicals", description: "Global crop protection major with operations across LatAm, Europe, India and US.", catalysts: ["Agrochem prices", "Debt reduction"] },

  // Consumer Discretionary & Retail
  { symbol: "TITAN", name: "Titan Company", sector: "Consumer Discretionary", industry: "Jewellery & Watches", description: "Tata-group jewellery and watches major with Tanishq dominating organized jewellery in India.", catalysts: ["Wedding & festive demand", "Gold prices", "Studded mix"] },
  { symbol: "DMART", name: "Avenue Supermarts (DMart)", sector: "Consumer Discretionary", industry: "Retail", description: "India's most profitable organized grocery & general merchandise retailer.", catalysts: ["Store additions", "SSSG", "Online (DMart Ready)"] },
  { symbol: "TRENT", name: "Trent", sector: "Consumer Discretionary", industry: "Apparel Retail", description: "Tata-group apparel retailer running Westside, Zudio and Star format stores.", catalysts: ["Zudio store rollout", "SSSG"] },
  { symbol: "NYKAA", name: "FSN E-Commerce (Nykaa)", sector: "Consumer Discretionary", industry: "E-commerce", description: "Beauty and personal care e-commerce platform with growing fashion vertical.", catalysts: ["BPC GMV growth", "Profitability of fashion"] },
  { symbol: "ZOMATO", name: "Zomato", sector: "Consumer Discretionary", industry: "Food Delivery", description: "Leading food delivery and quick-commerce (Blinkit) platform in India.", catalysts: ["Blinkit growth", "Take rate", "Food delivery margins"] },
  { symbol: "JUBLFOOD", name: "Jubilant FoodWorks", sector: "Consumer Discretionary", industry: "QSR", description: "Master franchisee of Domino's Pizza in India with multiple brands.", catalysts: ["SSSG recovery", "Premiumization"] },
  { symbol: "PAGEIND", name: "Page Industries", sector: "Consumer Discretionary", industry: "Apparel", description: "Exclusive licensee of Jockey innerwear in India and surrounding markets.", catalysts: ["Inventory cycle", "Volume growth"] },
  { symbol: "BATAINDIA", name: "Bata India", sector: "Consumer Discretionary", industry: "Footwear", description: "Largest footwear retailer in India.", catalysts: ["Premiumization", "SSSG"] },

  // Capital Goods & Defence
  { symbol: "SIEMENS", name: "Siemens India", sector: "Capital Goods", industry: "Industrial Automation", description: "Leading industrial automation, electrification and digital industry MNC subsidiary.", catalysts: ["Order inflows", "T&D capex"] },
  { symbol: "ABB", name: "ABB India", sector: "Capital Goods", industry: "Industrial Automation", description: "Industrial automation, robotics and electrification MNC subsidiary.", catalysts: ["Industrial capex", "Order inflows"] },
  { symbol: "BHEL", name: "Bharat Heavy Electricals", sector: "Capital Goods", industry: "Power Equipment", description: "Largest power equipment PSU; benefiting from thermal power capex revival.", catalysts: ["Thermal orders", "Execution"] },
  { symbol: "BEL", name: "Bharat Electronics", sector: "Defence", industry: "Defence Electronics", description: "Defence electronics PSU benefiting from indigenization push.", catalysts: ["Defence orders", "Export wins"] },
  { symbol: "HAL", name: "Hindustan Aeronautics", sector: "Defence", industry: "Aerospace & Defence", description: "Aerospace and defence PSU; primary aircraft and helicopter manufacturer for IAF.", catalysts: ["LCA Mk1A orders", "Export potential"] },
  { symbol: "MAZDOCK", name: "Mazagon Dock Shipbuilders", sector: "Defence", industry: "Shipbuilding", description: "Defence PSU shipbuilder for Indian Navy submarines and warships.", catalysts: ["Order pipeline", "Execution"] },

  // Logistics & Aviation
  { symbol: "INDIGO", name: "InterGlobe Aviation (IndiGo)", sector: "Aviation", industry: "Airlines", description: "India's largest airline by market share with low-cost carrier model.", catalysts: ["Yields", "ATF prices", "International expansion"] },
  { symbol: "CONCOR", name: "Container Corporation", sector: "Logistics", industry: "Container Logistics", description: "Largest container freight movement PSU in India.", catalysts: ["DFC ramp-up", "Privatization"] },
];

export const SECTORS: string[] = Array.from(new Set(UNIVERSE.map(u => u.sector))).sort();

export function getEntry(symbol: string): UniverseEntry | undefined {
  return UNIVERSE.find(u => u.symbol.toUpperCase() === symbol.toUpperCase());
}
