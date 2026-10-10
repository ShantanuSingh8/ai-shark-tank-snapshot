const assert = require('assert');
const { extractFinancialFacts } = require('../automation');

function fact(concept, unit, val, extra = {}) {
  return {
    label: concept,
    units: {
      [unit]: [{
        val,
        form: '20-F',
        fp: 'FY',
        fy: 2025,
        start: '2025-01-01',
        end: '2025-12-31',
        filed: '2026-02-27',
        accn: '0000891478-26-000030',
        ...extra,
      }],
    },
  };
}

const source = {
  form: '20-F',
  reportDate: '2025-12-31',
  filingDate: '2026-02-27',
  accessionNumber: '0000891478-26-000030',
  documentUrl: 'https://www.sec.gov/Archives/edgar/data/891478/000089147826000030/san-20251231.htm',
  factsUrl: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000891478.json',
};

const facts = {
  facts: {
    'ifrs-full': {
      FeeAndCommissionIncome: fact('Fee and commission income', 'EUR', 17387000000),
      RevenueFromInterest: fact('Interest income', 'EUR', 101710000000),
      GrossProfit: fact('Gross income', 'EUR', 58670000000),
      ProfitLoss: fact('Profit or loss', 'EUR', 15500000000),
      Assets: fact('Assets', 'EUR', 1867515000000),
      Equity: fact('Equity', 'EUR', 112748000000),
    },
  },
};

const extracted = extractFinancialFacts(facts, source, {
  sector: 'Financial Services',
  industry: 'Banks - Diversified',
});

assert.strictEqual(extracted.revenue.concept, 'GrossProfit');
assert.strictEqual(extracted.revenue.value, 58670000000);
assert.ok(extracted.revenue.notes.includes('Financial-services issuer'));

console.log('Banking revenue tests passed: financial issuers use a broader gross-income/revenue proxy instead of fee-only income.');