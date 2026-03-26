# PRESS CRM — Project Context

## What This Is

A B2B CRM system for PRESS, a premium juice and food company. Built on self-hosted Twenty CRM (v1.19.1) with custom automation scripts.

## About PRESS

- Sells cold-pressed juices, smoothies, shots, probiotic waters, cashew shakes, meals, soups, breakfast pots, snacks
- B2B/Wholesale: sells to QSR chains, hotels, cafes, restaurants, pubs, contract caterers, workplace/offices, leisure venues
- PRESS opens accounts directly but fulfilment goes through wholesalers
- PRESS cannot see wholesaler order data — periodic check-ins with end customers are critical
- Sales cycle: 2-6 weeks. Team: 1-3 salespeople. Active pipeline: 20-50 leads
- Google Workspace: @press-london.com. Also owns press-healthfoods.com
- Budget: up to £50/month for tooling

## Architecture

- **Twenty CRM v1.19.1** running locally via Docker at http://localhost:3000
  - Docker Compose location: ~/Desktop/twenty/packages/twenty-docker/
  - API: GraphQL at /graphql (data), /metadata (schema/fields)
  - API key in .env (TWENTY_API_KEY)
- **This repo** (~/Development/press-crm/ → github.com/adamstan10/pressaidev): automation scripts
- **GitHub CLI** authenticated as adamstan10 via SSH

## Critical Design Principle: Everything Editable in the CRM UI

All business data (wholesalers, products, team members, pipeline stages, sectors, etc.) must be editable through Twenty's web interface. Automation scripts must read ALL business data from the CRM via API at runtime. NEVER hardcode lists of wholesalers, products, team members, pipeline stages, or any business data in scripts. The only things in .env are API keys, URLs, and technical settings.

## Safety Rules

1. The system NEVER sends emails to customers — only reads emails and suggests actions
2. No hardcoded business data in scripts
3. All CRM config editable through the web UI
4. Use Twenty's official API for all programmatic interactions

## What Has Been Completed

### Phase 1-2: Environment + Twenty CRM (DONE)
- Node.js, Git, Docker, Claude Code, VS Code all installed
- Twenty CRM v1.19.1 running locally, admin account created, API key generated

### Phase 3: CRM Customisation (DONE)
All custom fields created via metadata API and verified:

**Company (21 custom fields):**
- companyType (SELECT: End Customer / Wholesaler / Contract Caterer)
- accountStatus (SELECT: Prospect / Active / Lapsed / Lost)
- currentProducts (MULTI_SELECT: 14 product categories)
- numberOfSites (NUMBER)
- customerLocationPostcode (TEXT)
- competitorBrandCurrentlyStocked (TEXT)
- companyNotes (TEXT)
- sector (SELECT: QSR / Hotel / Cafe / Restaurant / Pub & Bar / Contract Catering / Workplace & Office / Leisure & Entertainment / Retail / Other)
- shelfLifeTier (SELECT: Commercial / Wholegood)
- wholesalerType (SELECT: National Foodservice / Regional Foodservice / Specialist / Contract Caterer / Other)
- wholesalerCoverageArea (TEXT)
- listedSkus (MULTI_SELECT: same 14 product categories)
- pressSellInPriceList (TEXT)
- palletVolumeStatus (TEXT)
- wholesalerRelationshipRating (SELECT: Excellent / Good / Developing / New / Difficult)
- rtm (SELECT: all 11 wholesaler names + Other)
- rtmOther (TEXT: for unlisted wholesalers)
- linkedWholesalers (RELATION to Company)
- linkedAsWholesalerFor (RELATION, inverse side)
- preferredWholesaler (RELATION to Company)
- preferredWholesalerCompanies (RELATION, inverse side)

**Opportunity (8 custom fields):**
- opportunityType (SELECT: New Business / Expansion types)
- productInterest (MULTI_SELECT: 14 product categories)
- specificSkusDiscussed (TEXT)
- estimatedAnnualValue (CURRENCY)
- leadSource (SELECT: Cold Outreach / Referral types / Trade Show / Inbound / Expansion)
- lostReason (SELECT: Price / Competitor / Timing / No response / Product / Wholesaler / Other)
- expectedCloseDate (DATE)
- daysInCurrentStage (NUMBER)

**Person (5 custom + jobTitle built-in):**
- decisionMaker (BOOLEAN)
- bestContactMethod (SELECT: Email / Phone / WhatsApp / LinkedIn)
- nextFollowUpDate (DATE)
- nextAction (TEXT)
- contactNotes (TEXT)

**Pipeline Stages (on Opportunity "stage" field):**
Identified → Contacted → Engaged → Samples Sent → Tasting Feedback → Proposal & Pricing → Wholesaler Setup → First Order Placed → Lost → On Hold

**UI Customisations:**
- Opportunities is first in the sidebar navigation
- Opportunity "Name" field displays as "Target"
- Company "Employees" field displays as "# Sites"
- Social media fields (X, LinkedIn) are hidden on Company and Person

**Data:**
- 11 wholesaler Company records created (Chapple & Jenkins, Hunts, Classic Fine Foods, JDs, Mr Lemonade, DDC, CH & CO, The Estate Dairy, Bidfood, Reynolds, CLF)
- 1 test end customer (The Test Hotel Group), 1 test contact (Sarah Johnson), 1 test opportunity

**Scripts:**
- setup-crm.js — idempotent setup script that creates all fields, wholesalers, verifies state

## What Still Needs to Be Built

### Phase 4: Gmail Sync (NEXT)
Node.js app in ~/Development/press-crm/gmail-sync/ that:
- Connects to Gmail API via OAuth 2.0 (Google Workspace @press-london.com, Internal consent screen)
- Polls every 5 min for new emails, matches to CRM contacts, creates Activity records
- Dynamically discovers team members from Twenty's Members API
- Ignores internal emails (@press-london.com, @press-healthfoods.com)
- Handles threads, strips quoted text, prevents duplicates via Gmail message IDs
- Requires: Google Cloud project with Gmail API enabled, OAuth credentials

### Phase 5: AI Daily Brief
daily-brief.js that reads CRM data, sends to Claude API, posts to Slack #press-sales-crm at 7am weekdays.
- Requires: Anthropic API key, Slack bot setup

### Phase 6: Deploy to Server
Move from localhost to Hetzner VPS (~£4/month) so whole team can access. Set up HTTPS at crm.press-london.com.

### Phase 7: Data Migration
Import existing leads from Google Sheets via CSV.

### Phase 8: Wholesaler Router
wholesaler-router.js — AI-powered wholesaler recommendation based on CRM data.

### Phase 9: Advanced Features
Slack bot commands, lead scoring, wholesaler health checks, weekly manager report, inbound lead capture form.

## Product Categories (14)
250ml Mixed Juices, 250ml Pure Juices, 250ml Smoothies, 250ml Cashew Shakes, 750ml Mixed Juices, 750ml Smoothies, 100ml Shots, 400ml Probiotic Waters, 1L Juices, 1L Smoothies, Meals, Soups, Breakfast Pots, Snacks

## The 11 Wholesalers
Chapple & Jenkins, Hunts, Classic Fine Foods, JDs, Mr Lemonade, DDC, CH & CO, The Estate Dairy, Bidfood, Reynolds, CLF

## Technical Notes
- Twenty data API: POST http://localhost:3000/graphql
- Twenty metadata API: POST http://localhost:3000/metadata
- API auth: Bearer token from TWENTY_API_KEY in .env
- To create custom fields: use createOneField mutation on /metadata
- To update fields: use updateOneField mutation on /metadata
- Standard field labels changed via standardOverrides (label property)
- Navigation reordering via updateNavigationMenuItem mutation
- Fields deactivated (hidden) by setting isActive: false
- npm dependencies: dotenv
