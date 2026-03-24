#!/usr/bin/env node

/**
 * PRESS CRM Setup Script
 * Creates all custom fields on Twenty CRM via the metadata API.
 * Idempotent — checks what exists before creating.
 *
 * Usage: node setup-crm.js
 */

require('dotenv').config();

const TWENTY_API_URL = process.env.TWENTY_API_URL || 'http://localhost:3000';
const TWENTY_API_KEY = process.env.TWENTY_API_KEY;
const METADATA_URL = `${TWENTY_API_URL}/metadata`;
const GRAPHQL_URL = `${TWENTY_API_URL}/graphql`;

if (!TWENTY_API_KEY) {
  console.error('ERROR: TWENTY_API_KEY not set in .env');
  process.exit(1);
}

const AUTH_HEADERS = {
  'Authorization': `Bearer ${TWENTY_API_KEY}`,
  'Content-Type': 'application/json',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function gqlMetadata(query, variables = {}) {
  const res = await fetch(METADATA_URL, {
    method: 'POST',
    headers: AUTH_HEADERS,
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

async function gqlData(query, variables = {}) {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: AUTH_HEADERS,
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

// ─── Load existing custom fields (top-level query for reliable detection) ────

async function loadExistingCustomFields() {
  const data = await gqlMetadata(`{
    fields(paging: { first: 500 }, filter: { isCustom: { is: true } }) {
      edges {
        node { id name type label isCustom isActive options object { id nameSingular } }
      }
    }
  }`);
  const byObject = {};
  for (const edge of data.fields.edges) {
    const f = edge.node;
    const objName = f.object.nameSingular;
    if (!byObject[objName]) byObject[objName] = {};
    byObject[objName][f.name] = f;
  }
  return byObject;
}

async function loadObjectIds() {
  const data = await gqlMetadata(`{
    objects(paging: { first: 100 }) {
      edges { node { id nameSingular } }
    }
  }`);
  const ids = {};
  for (const edge of data.objects.edges) {
    ids[edge.node.nameSingular] = edge.node.id;
  }
  return ids;
}

// ─── Create a field if it doesn't exist ───────────────────────────────────────

async function ensureField(existingFields, objectIds, objectName, fieldDef) {
  const existing = existingFields[objectName] || {};
  if (existing[fieldDef.name]) {
    console.log(`  ✓ ${objectName}.${fieldDef.name} already exists`);
    return;
  }

  const objectMetadataId = objectIds[objectName];
  if (!objectMetadataId) {
    console.error(`  ✗ Object "${objectName}" not found`);
    return;
  }

  const input = {
    objectMetadataId,
    name: fieldDef.name,
    label: fieldDef.label,
    type: fieldDef.type,
    description: fieldDef.description || '',
    isCustom: true,
    isActive: true,
    isNullable: true,
    isLabelSyncedWithName: false,
  };

  if (fieldDef.icon) input.icon = fieldDef.icon;
  if (fieldDef.options) input.options = fieldDef.options;
  if (fieldDef.defaultValue !== undefined) input.defaultValue = fieldDef.defaultValue;
  if (fieldDef.settings) input.settings = fieldDef.settings;
  if (fieldDef.relationCreationPayload) input.relationCreationPayload = fieldDef.relationCreationPayload;

  const mutation = `mutation CreateField($input: CreateOneFieldMetadataInput!) {
    createOneField(input: $input) { id name label type }
  }`;

  try {
    await gqlMetadata(mutation, { input: { field: input } });
    console.log(`  ✚ Created ${objectName}.${fieldDef.name} (${fieldDef.type})`);
  } catch (err) {
    if (err.message.includes('already used')) {
      console.log(`  ✓ ${objectName}.${fieldDef.name} already exists (confirmed by API)`);
    } else {
      console.error(`  ✗ Failed to create ${objectName}.${fieldDef.name}: ${err.message}`);
    }
  }
}

// ─── Color cycle for options ──────────────────────────────────────────────────

const COLORS = ['green', 'turquoise', 'sky', 'blue', 'purple', 'pink', 'red', 'orange', 'yellow', 'gray'];

function makeOptions(labels) {
  return labels.map((label, i) => ({
    label,
    value: label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, ''),
    color: COLORS[i % COLORS.length],
    position: i,
  }));
}

// ─── Product category options (shared) ────────────────────────────────────────

const PRODUCT_CATEGORIES = [
  '250ml Mixed Juices', '250ml Pure Juices', '250ml Smoothies', '250ml Cashew Shakes',
  '750ml Mixed Juices', '750ml Smoothies', '100ml Shots', '400ml Probiotic Waters',
  '1L Juices', '1L Smoothies', 'Meals', 'Soups', 'Breakfast Pots', 'Snacks',
];

// ─── Field Definitions ───────────────────────────────────────────────────────

const COMPANY_FIELDS = [
  { name: 'companyType', label: 'Company Type', type: 'SELECT', icon: 'IconBuildingStore',
    description: 'Whether this is an End Customer, Wholesaler, or Contract Caterer',
    options: makeOptions(['End Customer', 'Wholesaler', 'Contract Caterer']) },
  { name: 'accountStatus', label: 'Account Status', type: 'SELECT', icon: 'IconStatusChange',
    description: 'Current status of this account',
    options: makeOptions(['Prospect', 'Active', 'Lapsed', 'Lost']) },
  { name: 'currentProducts', label: 'Current Products', type: 'MULTI_SELECT', icon: 'IconBottle',
    description: 'Product categories this company currently orders',
    options: makeOptions(PRODUCT_CATEGORIES) },
  { name: 'numberOfSites', label: 'Number of Sites', type: 'NUMBER', icon: 'IconBuildings',
    description: 'How many locations/sites this company has' },
  { name: 'customerLocationPostcode', label: 'Customer Location Postcode', type: 'TEXT', icon: 'IconMapPin',
    description: 'Primary location postcode for routing' },
  { name: 'competitorBrandCurrentlyStocked', label: 'Competitor Brand Currently Stocked', type: 'TEXT', icon: 'IconAlertTriangle',
    description: 'Competitor juice/food brands this company currently stocks' },
  { name: 'companyNotes', label: 'Notes', type: 'TEXT', icon: 'IconNotes',
    description: 'General notes about this company' },
  { name: 'sector', label: 'Sector', type: 'SELECT', icon: 'IconCategory',
    description: 'Business sector of the end customer',
    options: makeOptions(['QSR', 'Hotel', 'Café', 'Restaurant', 'Pub & Bar',
      'Contract Catering', 'Workplace & Office', 'Leisure & Entertainment', 'Retail', 'Other']) },
  { name: 'shelfLifeTier', label: 'Shelf Life Tier', type: 'SELECT', icon: 'IconClock',
    description: 'Whether this customer uses Commercial or Wholegood shelf life',
    options: makeOptions(['Commercial', 'Wholegood']) },
  { name: 'wholesalerType', label: 'Wholesaler Type', type: 'SELECT', icon: 'IconTruck',
    description: 'Type of wholesaler',
    options: makeOptions(['National Foodservice', 'Regional Foodservice', 'Specialist', 'Contract Caterer', 'Other']) },
  { name: 'wholesalerCoverageArea', label: 'Wholesaler Coverage Area', type: 'TEXT', icon: 'IconMap',
    description: 'Geographic area this wholesaler covers' },
  { name: 'listedSkus', label: 'Listed SKUs', type: 'MULTI_SELECT', icon: 'IconList',
    description: 'Product categories listed with this wholesaler',
    options: makeOptions(PRODUCT_CATEGORIES) },
  { name: 'pressSellInPriceList', label: 'PRESS Sell-In Price List', type: 'TEXT', icon: 'IconCurrencyPound',
    description: 'Pricing details for this wholesaler' },
  { name: 'palletVolumeStatus', label: 'Pallet Volume Status', type: 'TEXT', icon: 'IconPackage',
    description: 'Current pallet volume status and thresholds' },
  { name: 'wholesalerRelationshipRating', label: 'Wholesaler Relationship Rating', type: 'SELECT', icon: 'IconStar',
    description: 'Quality of relationship with this wholesaler',
    options: makeOptions(['Excellent', 'Good', 'Developing', 'New', 'Difficult']) },
];

const OPPORTUNITY_FIELDS = [
  { name: 'opportunityType', label: 'Opportunity Type', type: 'SELECT', icon: 'IconTarget',
    description: 'Type of sales opportunity',
    options: makeOptions(['New Business', 'Expansion — New SKUs', 'Expansion — New Sites',
      'Expansion — Volume Increase', 'Expansion — New Product Category']) },
  { name: 'productInterest', label: 'Product Interest', type: 'MULTI_SELECT', icon: 'IconBottle',
    description: 'Product categories the prospect is interested in',
    options: makeOptions(PRODUCT_CATEGORIES) },
  { name: 'specificSkusDiscussed', label: 'Specific SKUs Discussed', type: 'TEXT', icon: 'IconList',
    description: 'Specific product SKUs discussed with this prospect' },
  { name: 'estimatedAnnualValue', label: 'Estimated Annual Value', type: 'CURRENCY', icon: 'IconCurrencyPound',
    description: 'Estimated annual value of this opportunity in GBP' },
  { name: 'leadSource', label: 'Lead Source', type: 'SELECT', icon: 'IconSourceCode',
    description: 'How this lead was sourced',
    options: makeOptions(['Cold Outreach', 'Referral — Wholesaler', 'Referral — Customer',
      'Trade Show', 'Inbound Enquiry', 'Existing Account Expansion']) },
  { name: 'lostReason', label: 'Lost Reason', type: 'SELECT', icon: 'IconMoodSad',
    description: 'Reason the opportunity was lost',
    options: makeOptions(['Price too high', 'Chose competitor', 'Not the right time',
      'No response', 'Product not right', 'Wholesaler issues', 'Other']) },
  { name: 'expectedCloseDate', label: 'Expected Close Date', type: 'DATE', icon: 'IconCalendar',
    description: 'When this deal is expected to close' },
  { name: 'daysInCurrentStage', label: 'Days in Current Stage', type: 'NUMBER', icon: 'IconClock',
    description: 'Number of days the opportunity has been in its current stage' },
];

// jobTitle is a standard Person field — no need to create it
const PERSON_FIELDS = [
  { name: 'decisionMaker', label: 'Decision Maker', type: 'BOOLEAN', icon: 'IconUserCheck',
    description: 'Whether this contact is a decision maker' },
  { name: 'bestContactMethod', label: 'Best Contact Method', type: 'SELECT', icon: 'IconPhone',
    description: 'Preferred way to reach this contact',
    options: makeOptions(['Email', 'Phone', 'WhatsApp', 'LinkedIn']) },
  { name: 'nextFollowUpDate', label: 'Next Follow-Up Date', type: 'DATE', icon: 'IconCalendar',
    description: 'When to next follow up with this contact' },
  { name: 'nextAction', label: 'Next Action', type: 'TEXT', icon: 'IconChecklist',
    description: 'What to do next with this contact' },
  { name: 'contactNotes', label: 'Contact Notes', type: 'TEXT', icon: 'IconNotes',
    description: 'Notes about this contact' },
];

// ─── Wholesaler records ───────────────────────────────────────────────────────

const WHOLESALERS = [
  'Chapple & Jenkins', 'Hunts', 'Classic Fine Foods', "JD's", 'Mr Lemonade',
  'DDC', 'CH & CO', 'The Estate Dairy', 'Bidfood', 'Reynolds', 'CLF',
];

async function ensureWholesalers() {
  console.log('\n📦 Creating wholesaler Company records...');

  const data = await gqlData(`{
    companies { totalCount edges { node { id name } } }
  }`);

  const existingNames = new Set(
    data.companies.edges.map(e => e.node.name.toLowerCase())
  );

  for (const name of WHOLESALERS) {
    if (existingNames.has(name.toLowerCase())) {
      console.log(`  ✓ "${name}" already exists`);
      continue;
    }

    try {
      await gqlData(`mutation CreateCompany($input: CompanyCreateInput!) {
        createCompany(data: $input) { id name }
      }`, { input: { name, companyType: 'WHOLESALER' } });
      console.log(`  ✚ Created "${name}"`);
    } catch (err) {
      console.error(`  ✗ Failed to create "${name}": ${err.message}`);
    }
  }
}

// ─── Test data ────────────────────────────────────────────────────────────────

async function ensureTestData() {
  console.log('\n🧪 Checking test data...');

  const companies = await gqlData(`{
    companies { totalCount edges { node { id name companyType } } }
  }`);

  const hasTestCompany = companies.companies.edges.some(
    e => e.node.companyType === 'END_CUSTOMER'
  );

  if (hasTestCompany) {
    console.log('  ✓ Test end customer company exists');
  } else {
    console.log('  ℹ  No end customer test company found. You can create one in the CRM UI.');
  }

  const people = await gqlData(`{
    people { totalCount edges { node { id name { firstName lastName } } } }
  }`);
  console.log(`  ℹ  ${people.people.totalCount} contact(s) in the system`);

  const opps = await gqlData(`{
    opportunities { totalCount edges { node { id name stage } } }
  }`);
  console.log(`  ℹ  ${opps.opportunities.totalCount} opportunity(ies) in the system`);
}

// ─── Pipeline stages ──────────────────────────────────────────────────────────

async function checkPipelineStages() {
  console.log('\n📊 Pipeline stages:');

  const data = await gqlMetadata(`{
    fields(paging: { first: 500 }) {
      edges {
        node { name options object { nameSingular } }
      }
    }
  }`);

  for (const edge of data.fields.edges) {
    const f = edge.node;
    if (f.object.nameSingular === 'opportunity' && f.name === 'stage' && f.options) {
      for (const opt of f.options) {
        console.log(`  ✓ ${opt.label} (${opt.value})`);
      }
      return;
    }
  }
  console.log('  ⚠ Stage field not found — configure via Settings → Data Model → Opportunity');
}

// ─── Relation fields ─────────────────────────────────────────────────────────

async function ensureRelations(existingFields, objectIds) {
  console.log('\n🔗 Relation fields:');
  const companyFields = existingFields['company'] || {};

  const relations = ['linkedWholesalers', 'linkedAsWholesalerFor', 'preferredWholesaler', 'preferredWholesalerCompanies'];
  for (const name of relations) {
    if (companyFields[name]) {
      console.log(`  ✓ company.${name} exists`);
    } else {
      console.log(`  ✗ company.${name} MISSING — may need manual creation`);
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 PRESS CRM Setup Script');
  console.log(`   API: ${TWENTY_API_URL}`);
  console.log('');

  console.log('Loading current CRM schema...');
  const objectIds = await loadObjectIds();
  let existingFields = await loadExistingCustomFields();

  console.log(`  Company:     ${objectIds['company']}`);
  console.log(`  Person:      ${objectIds['person']}`);
  console.log(`  Opportunity: ${objectIds['opportunity']}`);

  // --- Company Fields ---
  console.log('\n🏢 Company fields:');
  for (const field of COMPANY_FIELDS) {
    await ensureField(existingFields, objectIds, 'company', field);
  }

  // --- Relations ---
  await ensureRelations(existingFields, objectIds);

  // --- Opportunity Fields ---
  console.log('\n💰 Opportunity fields:');
  for (const field of OPPORTUNITY_FIELDS) {
    await ensureField(existingFields, objectIds, 'opportunity', field);
  }

  // --- Person Fields ---
  console.log('\n👤 Person (Contact) fields:');
  console.log('  ✓ person.jobTitle (standard field, built-in)');
  for (const field of PERSON_FIELDS) {
    await ensureField(existingFields, objectIds, 'person', field);
  }

  // --- Pipeline Stages ---
  await checkPipelineStages();

  // --- Wholesaler Records ---
  await ensureWholesalers();

  // --- Test Data ---
  await ensureTestData();

  // --- Final Summary ---
  existingFields = await loadExistingCustomFields();
  const companyCount = Object.keys(existingFields['company'] || {}).length;
  const oppCount = Object.keys(existingFields['opportunity'] || {}).length;
  const personCount = Object.keys(existingFields['person'] || {}).length;

  console.log('\n📋 Summary:');
  console.log(`  Company custom fields:     ${companyCount}`);
  console.log(`  Opportunity custom fields:  ${oppCount}`);
  console.log(`  Person custom fields:       ${personCount}`);
  console.log('\n✅ Setup complete!');
  console.log('  → Open http://localhost:3000 to verify in the UI');
  console.log('  → Settings → Data Model to confirm dropdowns are editable');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
