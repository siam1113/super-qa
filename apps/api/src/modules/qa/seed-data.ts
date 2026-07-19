export const qaSeed = {
  executions: [
    { testName:'TC-1042 Payment decline shows banner', flow:'Checkout / Payment', browser:'Chrome', environment:'Staging', status:'Failed', duration:'48s', retry:1, confidence:87, owner:'Maya Chen', artifacts:{ screenshots:3, network:12, console:2 } },
    { testName:'TC-1001 Enterprise SSO login', flow:'Authentication / Login', browser:'Edge', environment:'Preview', status:'Passed', duration:'31s', retry:0, confidence:94, owner:'Ravi Patel', artifacts:{ screenshots:1, network:7, console:0 } },
    { testName:'TC-1128 Archived user cannot checkout', flow:'Checkout / Confirmation', browser:'Firefox', environment:'Staging', status:'Blocked', duration:'16s', retry:0, confidence:77, owner:'Elena Garcia', artifacts:{ screenshots:1, network:4, console:1 } },
    { testName:'TC-1177 Apply promotion code', flow:'Checkout / Add Item', browser:'Safari', environment:'Production', status:'Running', duration:'22s', retry:0, confidence:89, owner:'Noor Ahmed', artifacts:{ screenshots:0, network:5, console:0 } }
  ],
  testCases: [
    { id:'TC-1001', title:'Login with valid enterprise SSO user', priority:'P0', automation:'Automated', owner:'Ravi Patel', flow:'Authentication / Login', tags:['sso','smoke'], lastRun:'12m ago', passRate:99, coverage:94, risk:'High', aiScore:94 },
    { id:'TC-1042', title:'Payment decline shows banner', priority:'P0', automation:'Automated', owner:'Maya Chen', flow:'Checkout / Payment', tags:['payments'], lastRun:'Failed', passRate:87, coverage:82, risk:'High', aiScore:89 },
    { id:'TC-1128', title:'Archived user cannot checkout', priority:'P1', automation:'Partial', owner:'Elena Garcia', flow:'Checkout / Confirmation', tags:['users'], lastRun:'2h ago', passRate:73, coverage:42, risk:'Medium', aiScore:77 }
  ],
  flows: [
    { name:'Login', module:'Authentication', risk:'High', priority:'P0', coverage:88, automation:76, dependencies:['SSO provider','User fixtures'] },
    { name:'Payment', module:'Checkout', risk:'High', priority:'P0', coverage:42, automation:51, dependencies:['Payment gateway','Card fixtures'] }
  ],
  facts: [
    { text:'A locked account cannot start checkout', category:'Business Rule', confidence:96, source:'Confluence', aiGenerated:true, humanVerified:true, relatedObjects:['Checkout','User'] },
    { text:'Payment decline must show retry CTA', category:'Validation Rule', confidence:91, source:'Jira', aiGenerated:true, humanVerified:false, relatedObjects:['Payment'] }
  ],
  actions: [
    { name:'clickPayNow()', page:'Checkout', sourceCode:"await page.getByRole('button', { name: 'Pay now' }).click();", usageCount:12, dependencies:['payment form loaded'] },
    { name:'enterEmail()', page:'Login', sourceCode:"await page.getByLabel('Email').fill(email);", usageCount:31, dependencies:['login page loaded'] }
  ],
  domSnapshots: [
    { page:'Checkout Payment', screenshotUrl:'/artifacts/checkout-payment.png', domTree:'main#checkout > form.payment > button[role=button]', locatorTree:'getByRole(button, Pay now)', accessibilityScore:92 }
  ],
  dataSetup: [
    { entity:'User', operation:'Deactivate', supportedModes:['UI','API','Database','Fixture'], preview:{ email:'archived@example.com', status:'deactivated' } }
  ]
};
