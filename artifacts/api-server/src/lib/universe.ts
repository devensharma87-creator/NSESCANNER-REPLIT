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

const UNIVERSE_RAW: UniverseEntry[] = [
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
  { symbol: "DELHIVERY", name: "Delhivery", sector: "Logistics", industry: "3PL Logistics", description: "Largest fully-integrated logistics services provider in India.", catalysts: ["Express parcel growth", "PTL profitability"] },
  { symbol: "BLUEDART", name: "Blue Dart Express", sector: "Logistics", industry: "Express Logistics", description: "Premium express air and surface logistics provider.", catalysts: ["Yields", "Aviation costs"] },

  // Auto extras
  { symbol: "M&M", name: "Mahindra & Mahindra", sector: "Auto", industry: "Utility Vehicles & Tractors", description: "SUV and tractor major; M&M Financial subsidiary.", catalysts: ["SUV launches", "Tractor cycle", "EV roadmap"] },
  { symbol: "BAJAJ-AUTO", name: "Bajaj Auto", sector: "Auto", industry: "2W & 3W", description: "Leading 2W/3W maker with strong export franchise.", catalysts: ["Export demand", "Premium 2W mix"] },
  { symbol: "EICHERMOT", name: "Eicher Motors", sector: "Auto", industry: "Premium 2W & CV", description: "Royal Enfield premium motorcycles + VECV commercial vehicles JV.", catalysts: ["RE volumes", "International expansion"] },
  { symbol: "TVSMOTOR", name: "TVS Motor", sector: "Auto", industry: "2W", description: "Diversified two-wheeler maker with growing EV portfolio (iQube).", catalysts: ["EV scaleup", "Premium 2W"] },
  { symbol: "HEROMOTOCO", name: "Hero MotoCorp", sector: "Auto", industry: "2W", description: "India's largest two-wheeler maker by volumes.", catalysts: ["Rural demand", "Premium portfolio"] },
  { symbol: "ASHOKLEY", name: "Ashok Leyland", sector: "Auto", industry: "CV", description: "Second-largest commercial vehicle maker in India.", catalysts: ["CV cycle", "EV bus orders"] },
  { symbol: "BOSCHLTD", name: "Bosch", sector: "Auto", industry: "Auto Components", description: "Diversified auto components major.", catalysts: ["EV roadmap", "After-market"] },
  { symbol: "MOTHERSON", name: "Samvardhana Motherson", sector: "Auto", industry: "Auto Components", description: "Global auto components major with diversified geography and customer base.", catalysts: ["Global auto demand", "EV content per vehicle"] },
  { symbol: "BHARATFORG", name: "Bharat Forge", sector: "Auto", industry: "Auto Components & Defence", description: "Forging major with growing defence and aerospace presence.", catalysts: ["CV demand", "Defence orders"] },
  { symbol: "TIINDIA", name: "Tube Investments", sector: "Auto", industry: "Auto Components", description: "Diversified engineering with auto components, EV (TI-Clean Mobility) and metals.", catalysts: ["EV ramp-up", "Industrials"] },

  // Pharma extras
  { symbol: "SUNPHARMA", name: "Sun Pharma", sector: "Pharma", industry: "Pharma", description: "India's largest pharma company; strong specialty business in US.", catalysts: ["Specialty franchise (Ilumya, Cequa)", "US generics pricing"] },
  { symbol: "DRREDDY", name: "Dr Reddy's Labs", sector: "Pharma", industry: "Pharma", description: "Diversified pharma major with US generics, EM and India presence.", catalysts: ["gRevlimid runoff", "Biosimilars"] },
  { symbol: "CIPLA", name: "Cipla", sector: "Pharma", industry: "Pharma", description: "Major generics maker with strong India business and US specialty plans.", catalysts: ["US specialty launches", "India branded growth"] },
  { symbol: "DIVISLAB", name: "Divis Labs", sector: "Pharma", industry: "API & Custom Synthesis", description: "Top API and custom synthesis manufacturer for global innovators.", catalysts: ["CSM order book", "API price normalization"] },
  { symbol: "LUPIN", name: "Lupin", sector: "Pharma", industry: "Pharma", description: "Top-5 Indian pharma major with US generics, India branded and respiratory franchise.", catalysts: ["US complex generics", "Margin recovery"] },
  { symbol: "AUROPHARMA", name: "Aurobindo Pharma", sector: "Pharma", industry: "Pharma & Biosimilars", description: "Large generics player; biosimilars pipeline.", catalysts: ["Biosimilar launches", "US compliance"] },
  { symbol: "BIOCON", name: "Biocon", sector: "Pharma", industry: "Biopharma", description: "Leading Indian biopharma with biosimilars (via Biocon Biologics) and generics.", catalysts: ["Biosimilar ramp-up", "Margin expansion"] },
  { symbol: "TORNTPHARM", name: "Torrent Pharma", sector: "Pharma", industry: "Pharma", description: "Strong India branded formulations player.", catalysts: ["India branded growth", "US recovery"] },
  { symbol: "ALKEM", name: "Alkem Labs", sector: "Pharma", industry: "Pharma", description: "Top India branded formulations player; expanding chronics.", catalysts: ["Chronic mix shift", "US growth"] },
  { symbol: "ZYDUSLIFE", name: "Zydus Lifesciences", sector: "Pharma", industry: "Pharma", description: "Diversified Indian pharma with US generics, vaccines and biosimilars.", catalysts: ["US specialty pipeline", "India growth"] },
  { symbol: "APOLLOHOSP", name: "Apollo Hospitals", sector: "Pharma", industry: "Healthcare Services", description: "India's largest hospital chain with diagnostics and pharmacy verticals.", catalysts: ["ARPOB growth", "Apollo24/7"] },
  { symbol: "MAXHEALTH", name: "Max Healthcare", sector: "Pharma", industry: "Healthcare Services", description: "Premium hospital chain in NCR/Maharashtra.", catalysts: ["Bed additions", "Occupancy"] },
  { symbol: "FORTIS", name: "Fortis Healthcare", sector: "Pharma", industry: "Healthcare Services", description: "Pan-India hospital chain owned by IHH Healthcare.", catalysts: ["Occupancy", "Diagnostics turnaround"] },

  // FMCG extras
  { symbol: "HINDUNILVR", name: "Hindustan Unilever", sector: "FMCG", industry: "FMCG", description: "India's largest FMCG company.", catalysts: ["Rural demand", "Premiumization"] },
  { symbol: "ITC", name: "ITC", sector: "FMCG", industry: "FMCG / Cigarettes", description: "Diversified conglomerate with cigarettes, FMCG, hotels and paperboards.", catalysts: ["Cigarette tax stability", "Hotels demerger"] },
  { symbol: "NESTLEIND", name: "Nestle India", sector: "FMCG", industry: "FMCG", description: "Indian arm of Nestle, dominant in instant noodles and coffee.", catalysts: ["Volume growth", "Pricing"] },
  { symbol: "BRITANNIA", name: "Britannia Industries", sector: "FMCG", industry: "Biscuits", description: "Leading biscuits maker.", catalysts: ["Rural demand", "Premium portfolio"] },
  { symbol: "DABUR", name: "Dabur India", sector: "FMCG", industry: "FMCG / Ayurveda", description: "Ayurveda and naturals focused FMCG major.", catalysts: ["Healthcare growth", "Hair care recovery"] },
  { symbol: "MARICO", name: "Marico", sector: "FMCG", industry: "FMCG", description: "Hair oils, edible oils and foods major.", catalysts: ["Saffola Foods scaling", "Copra prices"] },
  { symbol: "GODREJCP", name: "Godrej Consumer", sector: "FMCG", industry: "FMCG", description: "Home care and personal care major with Indonesia and Africa exposure.", catalysts: ["Africa turnaround", "India volume growth"] },
  { symbol: "COLPAL", name: "Colgate-Palmolive India", sector: "FMCG", industry: "FMCG / Oral Care", description: "Dominant oral care player in India.", catalysts: ["Premiumization", "Distribution"] },
  { symbol: "TATACONSUM", name: "Tata Consumer Products", sector: "FMCG", industry: "FMCG / F&B", description: "Tea, coffee, salt, pulses and growing packaged foods franchise.", catalysts: ["Growth businesses scaling", "Tea prices"] },
  { symbol: "VBL", name: "Varun Beverages", sector: "FMCG", industry: "Beverages", description: "Largest PepsiCo bottler outside the US, with strong Indian and African franchise.", catalysts: ["Volume growth", "Africa expansion"] },
  { symbol: "UBL", name: "United Breweries", sector: "FMCG", industry: "Beverages", description: "India's largest beer maker (Kingfisher).", catalysts: ["Premiumization", "State excise"] },
  { symbol: "MCDOWELL-N", name: "United Spirits", sector: "FMCG", industry: "Spirits", description: "India's largest spirits maker (Diageo subsidiary).", catalysts: ["P&A volume mix", "State pricing"] },

  // Metals & Mining extras
  { symbol: "TATASTEEL", name: "Tata Steel", sector: "Metals", industry: "Steel", description: "India's largest steel producer with UK/EU operations being restructured.", catalysts: ["Steel prices", "UK restructuring"] },
  { symbol: "JSWSTEEL", name: "JSW Steel", sector: "Metals", industry: "Steel", description: "India's second-largest steel producer; aggressive capex.", catalysts: ["Capex execution", "Spreads"] },
  { symbol: "HINDALCO", name: "Hindalco", sector: "Metals", industry: "Aluminium & Copper", description: "Aluminium and copper major; owns Novelis (US auto sheet).", catalysts: ["Aluminium prices", "Novelis margins"] },
  { symbol: "VEDL", name: "Vedanta", sector: "Metals", industry: "Diversified Metals", description: "Diversified metals major with zinc, aluminium, oil, iron ore.", catalysts: ["Demerger", "Commodity prices"] },
  { symbol: "NMDC", name: "NMDC", sector: "Metals", industry: "Iron Ore", description: "India's largest iron ore producer.", catalysts: ["Iron ore prices", "Volume growth"] },
  { symbol: "COALINDIA", name: "Coal India", sector: "Metals", industry: "Coal Mining", description: "World's largest coal mining company.", catalysts: ["Power demand", "E-auction premiums"] },
  { symbol: "JINDALSTEL", name: "Jindal Steel & Power", sector: "Metals", industry: "Steel & Power", description: "Integrated steel and power producer; mineral assets.", catalysts: ["Capex completion", "Coking coal"] },
  { symbol: "SAIL", name: "SAIL", sector: "Metals", industry: "Steel", description: "Largest steel PSU in India.", catalysts: ["Steel prices", "Cost reduction"] },
  { symbol: "HINDZINC", name: "Hindustan Zinc", sector: "Metals", industry: "Zinc & Silver", description: "Largest zinc producer in India; subsidiary of Vedanta.", catalysts: ["Zinc/silver prices", "Cost of production"] },

  // Cement extras
  { symbol: "ULTRACEMCO", name: "UltraTech Cement", sector: "Cement", industry: "Cement", description: "India's largest cement maker (Aditya Birla group).", catalysts: ["Capacity expansion", "Pricing discipline"] },
  { symbol: "SHREECEM", name: "Shree Cement", sector: "Cement", industry: "Cement", description: "Top-3 cement producer; strong North/East India presence.", catalysts: ["Capex", "Cost leadership"] },
  { symbol: "AMBUJACEM", name: "Ambuja Cements", sector: "Cement", industry: "Cement", description: "Adani group cement major (with ACC).", catalysts: ["Cost synergies", "Capex"] },
  { symbol: "DALBHARAT", name: "Dalmia Bharat", sector: "Cement", industry: "Cement", description: "South/East India focused cement maker.", catalysts: ["Capacity ramp", "South India pricing"] },

  // Capital Goods extras
  { symbol: "CUMMINSIND", name: "Cummins India", sector: "Capital Goods", industry: "Engines", description: "Powergen, industrial and automotive engines major (Cummins Inc subsidiary).", catalysts: ["Powergen demand", "Exports"] },
  { symbol: "HAVELLS", name: "Havells India", sector: "Capital Goods", industry: "Electricals & Consumer Durables", description: "Switchgear, cables, lighting and consumer durables (Lloyd) major.", catalysts: ["Lloyd ACs", "Cable & wires demand"] },
  { symbol: "POLYCAB", name: "Polycab India", sector: "Capital Goods", industry: "Cables & Wires", description: "India's largest cables and wires maker; growing FMEG presence.", catalysts: ["Capex cycle", "FMEG growth"] },
  { symbol: "VOLTAS", name: "Voltas", sector: "Capital Goods", industry: "Air Conditioning", description: "Tata-group cooling products and projects business.", catalysts: ["Summer AC demand", "Order book"] },
  { symbol: "CROMPTON", name: "Crompton Greaves Consumer", sector: "Capital Goods", industry: "Electrical Consumer Durables", description: "Fans, lighting and pumps major (now expanded into kitchen via Butterfly).", catalysts: ["Premium fans mix", "Butterfly turnaround"] },
  { symbol: "BLUESTARCO", name: "Blue Star", sector: "Capital Goods", industry: "Air Conditioning & Cooling", description: "Air conditioning, commercial refrigeration and projects major.", catalysts: ["AC seasonal demand", "Projects margin"] },

  // NBFCs / Financials extras
  { symbol: "HDFCAMC", name: "HDFC AMC", sector: "Financials", industry: "AMC", description: "One of India's largest mutual fund houses.", catalysts: ["Equity AUM mix", "SIP flows"] },
  { symbol: "NIPPONLIFE", name: "Nippon Life India AMC", sector: "Financials", industry: "AMC", description: "Top-5 mutual fund house with strong B-30 distribution.", catalysts: ["Equity AUM mix", "Yield"] },
  { symbol: "BAJAJHLDNG", name: "Bajaj Holdings", sector: "Financials", industry: "Holding", description: "Holding company with stakes in Bajaj Finserv and Bajaj Auto.", catalysts: ["Underlying value unlocking"] },
  { symbol: "RECLTD", name: "REC Limited", sector: "Financials", industry: "Power Finance", description: "Specialty PSU lender to power and infra projects.", catalysts: ["Renewables financing", "Asset quality"] },
  { symbol: "PFC", name: "Power Finance Corp", sector: "Financials", industry: "Power Finance", description: "Largest PSU lender to power sector projects.", catalysts: ["Renewables lending", "Yield"] },
  { symbol: "IRFC", name: "Indian Railway Finance Corp", sector: "Financials", industry: "Railway Finance", description: "Dedicated PSU lender to Indian Railways.", catalysts: ["Railway capex", "Yield"] },
  { symbol: "MUTHOOTFIN", name: "Muthoot Finance", sector: "Financials", industry: "Gold Loan NBFC", description: "Largest gold loan NBFC.", catalysts: ["Gold prices", "AUM growth"] },
  { symbol: "MANAPPURAM", name: "Manappuram Finance", sector: "Financials", industry: "Gold Loan NBFC", description: "Diversified gold loan NBFC.", catalysts: ["Gold prices", "Microfinance cycle"] },
  { symbol: "PEL", name: "Piramal Enterprises", sector: "Financials", industry: "Diversified NBFC", description: "Diversified NBFC with retail and wholesale lending.", catalysts: ["Retail mix shift", "Asset quality"] },
  { symbol: "LICHSGFIN", name: "LIC Housing Finance", sector: "Financials", industry: "Housing Finance", description: "Top housing finance company in India (LIC subsidiary).", catalysts: ["Spreads", "Disbursement growth"] },
  { symbol: "BAJAJHFL", name: "Bajaj Housing Finance", sector: "Financials", industry: "Housing Finance", description: "Bajaj Finance housing finance arm.", catalysts: ["AUM growth", "NIM"] },

  // Banks extras (PSU + small private)
  { symbol: "BANKBARODA", name: "Bank of Baroda", sector: "Banking", industry: "Public Bank", description: "Top-3 PSU bank by deposits.", catalysts: ["NIM", "Asset quality"] },
  { symbol: "PNB", name: "Punjab National Bank", sector: "Banking", industry: "Public Bank", description: "Large PSU bank.", catalysts: ["Asset quality", "Slippages"] },
  { symbol: "CANBK", name: "Canara Bank", sector: "Banking", industry: "Public Bank", description: "Major PSU bank.", catalysts: ["NIM", "Asset quality"] },
  { symbol: "UNIONBANK", name: "Union Bank of India", sector: "Banking", industry: "Public Bank", description: "Major PSU bank.", catalysts: ["Recoveries", "NIM"] },
  { symbol: "IDFCFIRSTB", name: "IDFC First Bank", sector: "Banking", industry: "Private Bank", description: "Mid-sized private bank with retail focus.", catalysts: ["CASA growth", "Credit cost"] },
  { symbol: "FEDERALBNK", name: "Federal Bank", sector: "Banking", industry: "Private Bank", description: "South India focused private bank.", catalysts: ["NIM", "Subsidiary IPOs"] },
  { symbol: "AUBANK", name: "AU Small Finance Bank", sector: "Banking", industry: "Small Finance Bank", description: "Largest small finance bank in India.", catalysts: ["Universal bank licence", "Deposit growth"] },
  { symbol: "RBLBANK", name: "RBL Bank", sector: "Banking", industry: "Private Bank", description: "Mid-sized private bank with credit cards franchise.", catalysts: ["Credit costs", "Bajaj Finance partnership"] },

  // PSU & Infrastructure extras
  { symbol: "IRCTC", name: "IRCTC", sector: "Logistics", industry: "Travel & E-Catering", description: "Indian Railways' ticketing, catering and tourism PSU.", catalysts: ["Convenience fee", "Vande Bharat"] },
  { symbol: "RVNL", name: "Rail Vikas Nigam", sector: "Construction", industry: "Railway Infra", description: "Indian Railways' arm for infrastructure project execution.", catalysts: ["Order inflows", "Execution"] },
  { symbol: "IRCON", name: "Ircon International", sector: "Construction", industry: "Railway Infra", description: "Railway and highway construction PSU.", catalysts: ["Order book", "International projects"] },
  { symbol: "GMRINFRA", name: "GMR Airports Infra", sector: "Construction", industry: "Airports", description: "Airport operator (Delhi, Hyderabad, Goa).", catalysts: ["Passenger traffic", "Tariff orders"] },
  { symbol: "ADANIPORTS", name: "Adani Ports & SEZ", sector: "Logistics", industry: "Port Operator", description: "India's largest private port operator.", catalysts: ["Volume growth", "Container mix"] },
  { symbol: "ADANIENT", name: "Adani Enterprises", sector: "Energy", industry: "Conglomerate / New Energy", description: "Adani group flagship; airports, mining, new energy.", catalysts: ["New energy capex", "Airports"] },
  { symbol: "ADANIPOWER", name: "Adani Power", sector: "Energy", industry: "Power Generation", description: "Largest private thermal power producer.", catalysts: ["PLF", "Tariff recoveries"] },
];

// Dedupe by symbol (first occurrence wins)
export const UNIVERSE: UniverseEntry[] = (() => {
  const seen = new Set<string>();
  const out: UniverseEntry[] = [];
  for (const e of UNIVERSE_RAW) {
    const k = e.symbol.toUpperCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
})();

export const SECTORS: string[] = Array.from(new Set(UNIVERSE.map(u => u.sector))).sort();

export function getEntry(symbol: string): UniverseEntry | undefined {
  return UNIVERSE.find(u => u.symbol.toUpperCase() === symbol.toUpperCase());
}
