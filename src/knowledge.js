'use strict';

/**
 * Curated, deterministic safety knowledge.
 * Content follows widely published public guidance (NDMA India, Ready.gov,
 * WHO heat-health and IFRC preparedness material). Gemini personalises and
 * explains this content but can never remove it, so the safety-critical core
 * stays correct even if the AI is unavailable.
 */

const SUPPLY_LABELS = Object.freeze({
  water: 'Drinking water',
  food: 'Non-perishable food (3 days)',
  first_aid: 'First-aid kit',
  flashlight: 'Torch / flashlight + spare batteries',
  power_bank: 'Charged power bank',
  radio: 'Battery or wind-up radio',
  documents: 'Copies of ID, insurance and medical records (waterproof bag)',
  cash: 'Emergency cash in small notes',
  medicines: '7-day supply of regular medicines',
  whistle: 'Whistle to signal for help',
  masks: 'N95 / FFP2 masks',
});

const HAZARDS = Object.freeze({
  general: {
    label: 'General emergency',
    evacuationLikely: false,
    essentials: ['water', 'food', 'first_aid', 'flashlight', 'power_bank', 'documents', 'cash', 'medicines'],
    prepare: [
      { id: 'go-bag', text: 'Pack a grab-and-go bag for every member of the household', why: 'In most emergencies you get minutes, not hours, to leave.' },
      { id: 'contacts', text: 'Write emergency contacts on paper and pick one out-of-town contact person', why: 'Phone batteries die and local networks jam during disasters.' },
      { id: 'meeting', text: 'Agree on a family meeting point near home and one outside your area', why: 'Families are often separated when an emergency starts.' },
      { id: 'alerts', text: 'Turn on government emergency alerts on every phone', why: 'Official alerts give the earliest, most reliable warning.' },
    ],
    emergency: [
      'If anyone is in immediate danger, call your emergency number now.',
      'Move away from the danger to a safe, open or sturdy place.',
      'Follow instructions from local authorities and official alerts only.',
      'Check on the people around you, especially children, elders and anyone with a disability.',
      'Save phone battery: lower brightness and close unused apps.',
    ],
  },
  flood: {
    label: 'Flood',
    evacuationLikely: true,
    essentials: ['water', 'food', 'first_aid', 'flashlight', 'power_bank', 'radio', 'documents', 'cash', 'medicines', 'whistle'],
    prepare: [
      { id: 'elevate', text: 'Move documents, medicines and electronics to the highest shelf or floor', why: 'Floodwater rises fast and destroys what is left low.' },
      { id: 'routes', text: 'Learn two evacuation routes to higher ground', why: 'Your first route may already be under water.' },
      { id: 'mains', text: 'Find out how to switch off your mains electricity and gas', why: 'Electrocution is a leading cause of death in floods.' },
      { id: 'alerts', text: 'Turn on government emergency and flood alerts on your phone', why: 'Flash floods can arrive with less than an hour of warning.' },
    ],
    emergency: [
      'If authorities say evacuate, leave now. Do not wait to see the water.',
      'Switch off electricity at the mains only if you are dry and it is safe.',
      'Move to the highest floor with water, medicines, phone and power bank.',
      'Never walk or drive through floodwater: 15 cm can knock you over and 30 cm can float a car.',
      'Signal for help with a whistle, torch or bright cloth. Go onto the roof only if water forces you.',
    ],
  },
  heatwave: {
    label: 'Heatwave',
    evacuationLikely: false,
    essentials: ['water', 'first_aid', 'medicines', 'power_bank'],
    prepare: [
      { id: 'cool-room', text: 'Pick the coolest room and shade its windows during the day', why: 'Indoor temperatures can stay dangerous for days.' },
      { id: 'ors', text: 'Stock oral rehydration salts (ORS) and plan to drink water every hour', why: 'Thirst is a late sign of dehydration.' },
      { id: 'schedule', text: 'Move outdoor work and errands before 11 am or after 4 pm', why: 'Heat stress peaks in the afternoon.' },
      { id: 'buddy', text: 'Agree on twice-daily check-ins with an elderly or isolated neighbour', why: 'Most heat deaths happen to people alone at home.' },
    ],
    emergency: [
      'Move to the coolest place you can reach: shade, a lower floor or an air-conditioned public building.',
      'Drink water or ORS in small, frequent sips. Avoid alcohol and very sugary drinks.',
      'Cool the body with wet cloths on the neck, armpits and groin, and fan the skin.',
      'Heatstroke signs: confusion, hot dry skin, fainting. Call your emergency number immediately.',
      'Never leave children, elders or pets in a parked vehicle, even for a few minutes.',
    ],
  },
  cyclone: {
    label: 'Cyclone / severe storm',
    evacuationLikely: true,
    essentials: ['water', 'food', 'first_aid', 'flashlight', 'power_bank', 'radio', 'documents', 'cash', 'medicines', 'whistle'],
    prepare: [
      { id: 'secure', text: 'Tie down or bring inside loose objects such as pots, sheets and furniture', why: 'Flying debris causes many storm injuries.' },
      { id: 'shelter', text: 'Locate your nearest cyclone shelter or strong public building', why: 'Weak or tin-roof homes may not survive strong winds.' },
      { id: 'charge', text: 'Charge every phone and power bank, and fill containers with water', why: 'Power and water supply often fail for days.' },
      { id: 'alerts', text: 'Follow official cyclone warnings on radio or your phone', why: 'Cyclone paths change and warnings are updated often.' },
    ],
    emergency: [
      'If told to evacuate, go to the designated shelter now.',
      'If staying, shelter in the strongest interior room, away from windows.',
      'A sudden calm may be the eye of the storm. Stay inside until officials say it has passed.',
      'Unplug appliances and keep the torch, radio and medicines with you.',
      'Afterwards, avoid fallen power lines and floodwater.',
    ],
  },
  earthquake: {
    label: 'Earthquake',
    evacuationLikely: false,
    essentials: ['water', 'food', 'first_aid', 'flashlight', 'whistle', 'documents', 'medicines', 'power_bank'],
    prepare: [
      { id: 'anchor', text: 'Fix tall furniture, cupboards and water heaters to the wall', why: 'Falling objects cause most earthquake injuries indoors.' },
      { id: 'safe-spots', text: 'Identify a sturdy table or inside wall in every room', why: 'You have seconds to react when shaking starts.' },
      { id: 'gas', text: 'Learn how to turn off gas at the cylinder or mains', why: 'Gas leaks after earthquakes cause fires.' },
      { id: 'meeting', text: 'Agree on an open-ground meeting point away from buildings', why: 'Aftershocks can bring down weakened structures.' },
    ],
    emergency: [
      'DROP to your hands and knees, take COVER under a sturdy table and HOLD ON until the shaking stops.',
      'Stay away from windows, glass and tall furniture. Do not run outside during shaking.',
      'Never use lifts. Use the stairs only after the shaking stops.',
      'If you are outdoors, move to open ground away from buildings, trees and power lines.',
      'After shaking: check for injuries, leave if you smell gas, and expect aftershocks.',
    ],
  },
  wildfire: {
    label: 'Wildfire',
    evacuationLikely: true,
    essentials: ['water', 'first_aid', 'documents', 'medicines', 'power_bank', 'cash', 'radio', 'masks'],
    prepare: [
      { id: 'clear', text: 'Clear dry leaves and flammable material within 10 m of your home', why: 'Embers can travel more than a kilometre ahead of the fire.' },
      { id: 'routes', text: 'Know two ways out of your neighbourhood', why: 'Fire can block roads in minutes.' },
      { id: 'masks', text: 'Keep N95 masks ready for smoke', why: 'Smoke harms the lungs long before flames arrive.' },
      { id: 'alerts', text: 'Sign up for local fire and evacuation alerts', why: 'Leaving early is the single biggest life-saver.' },
    ],
    emergency: [
      'Leave as soon as you are told to, or earlier if you feel unsafe.',
      'Wear an N95 mask, long cotton sleeves and closed shoes.',
      'Close all windows and doors behind you, but leave them unlocked for firefighters.',
      'Drive with headlights on and windows closed. Never drive through flames.',
      'If trapped, shelter in a cleared area or a building with closed doors, low to the ground.',
    ],
  },
  air_pollution: {
    label: 'Severe air pollution',
    evacuationLikely: false,
    essentials: ['masks', 'medicines', 'first_aid', 'water'],
    prepare: [
      { id: 'clean-room', text: 'Set up a clean-air room: windows sealed, air purifier if you have one', why: 'Indoor air can be far cleaner than outdoor air.' },
      { id: 'masks', text: 'Keep N95 / FFP2 masks for everyone who must go out', why: 'Cloth and surgical masks do not filter fine particles (PM2.5).' },
      { id: 'inhalers', text: 'Keep inhalers and breathing medicines topped up', why: 'Pollution spikes trigger asthma and heart problems.' },
      { id: 'check-aqi', text: 'Check the air quality index (AQI) before outdoor activity', why: 'Outdoor exercise on bad days multiplies the dose you breathe in.' },
    ],
    emergency: [
      'Stay indoors with windows and doors closed.',
      'Wear an N95 mask if you must go outside, and avoid physical exertion.',
      'Keep children, elders and anyone with heart or lung disease indoors.',
      'Seek medical help urgently for chest pain, breathlessness or bluish lips.',
      'Avoid burning anything indoors: incense, candles and wood stoves add pollution.',
    ],
  },
});

/** Personal-need modifiers: what changes because of who lives in the household. */
const NEED_ACTIONS = Object.freeze({
  insulin: { text: 'Keep a 7-day insulin supply in a cool pack and label it', why: 'Insulin spoils in heat and pharmacies may close.', heatSensitive: true },
  oxygen: { text: 'Arrange backup power or spare cylinders for oxygen, and tell your power company you depend on electricity for medical reasons', why: 'Power cuts are life-threatening for oxygen users.', critical: true },
  dialysis: { text: 'Ask your dialysis centre for its emergency plan and keep a 3-day emergency diet', why: 'Missed dialysis becomes dangerous within days.', critical: true },
  mobility: { text: 'Arrange an evacuation buddy and plan a step-free way out', why: 'Lifts and ramps may be unusable in an emergency.' },
  hearing: { text: 'Set phone alerts to vibrate and flash, and carry a card that says "I am deaf / hard of hearing"', why: 'Sirens and loudspeaker warnings may be missed.' },
  vision: { text: 'Mark your go-bag with tactile labels and put emergency contacts on speed dial', why: 'Finding things quickly in the dark or a crowd is harder.' },
  pregnancy: { text: 'Pack your pregnancy records and know the route to the nearest maternity hospital', why: 'Stress and disruption can trigger early labour.' },
  infant: { text: 'Pack 3 days of formula, clean water for feeds, nappies and a baby carrier', why: 'Infants dehydrate faster than adults.', critical: true },
  mental_health: { text: 'Keep a 2-week medication supply and write down a short calming plan', why: 'Crises raise anxiety, and routine care is often disrupted.' },
});

/** Emergency numbers for common countries (ISO 3166 alpha-2). */
const EMERGENCY_NUMBERS = Object.freeze({
  IN: '112',
  US: '911',
  CA: '911',
  MX: '911',
  PH: '911',
  GB: '999',
  IE: '112',
  BD: '999',
  LK: '119',
  NP: '112',
  PK: '1122',
  AU: '000',
  NZ: '111',
  JP: '119',
  KR: '119',
  CN: '120',
  SG: '995',
  MY: '999',
  ID: '112',
  AE: '999',
  SA: '911',
  ZA: '112',
  KE: '112',
  NG: '112',
  BR: '193',
  DE: '112',
  FR: '112',
  ES: '112',
  IT: '112',
  NL: '112',
});

module.exports = { SUPPLY_LABELS, HAZARDS, NEED_ACTIONS, EMERGENCY_NUMBERS };
