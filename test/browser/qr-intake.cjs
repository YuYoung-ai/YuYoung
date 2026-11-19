const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '../..');
const now = new Date().toISOString();
const day = '2030-06-18';
const preference = day + 'T10:00';
const alternate = day + 'T14:00';
const item = (id, confirmed, revision = 1) => ({
  request: {id, revision, registeredAt: now, createdAt: now, hospitalName: '테스트 병원 '+id,
    symptom: '점검 요청', visitAt: preference, engineer: '', status: confirmed ? '방문예정' : '접수',
    qrIntake: {preferredStartAts: [preference], requestedVisitAt: preference, appointmentConfirmed: confirmed}},
  contact: {name: '테스트', phone: '01000000000'}, photos: [], detailLoaded: true,
});

const staffFixture = `<!doctype html><html lang="ko" data-theme="dark"><head>
<link rel="stylesheet" href="/css/work-reservations.css">
<link rel="stylesheet" href="/css/qr-usability.css">
<link rel="stylesheet" href="/css/qr-design.css">
<link rel="stylesheet" href="/css/baz-quality.css">
</head><body class="staff-work"><main><button id="qr-workflow-open"></button></main>
<script>
window.BazQrRuntime={api:'/_local/api'};
window.BazWorkTabs={register(name,button,panel){panel.hidden=false;}};
window.BazAuth={name:()=> 'test-admin',token:()=> 'test-token'};
async function call(action,p){const response=await fetch('/_local/api',{method:'POST',body:JSON.stringify({action,...p})});return response.json();}
window.BazWorkAPI={get:call,post:call,id:()=>crypto.randomUUID()};
</script><script src="/js/qr-design.js"></script><script src="/js/baz-qr-workflow.js"></script></body></html>`;
const config = `window.QrCustomerRuntime={local:true,api:'/_local/customer',file:'/_local/file'};`;

async function run(){
  const cases = Array.from({length: 10000}, (_, i) => item('case-'+String(i).padStart(4,'0'), false));
  cases[0].photos=[{id:'photo-wide'},{id:'photo-square'}];
  cases[20] = item('later-confirmed', true);
  cases[21].changeRequest={kind:'cancel',state:'pending',note:'테스트 취소 요청'};
  const listReads = [], writes = [], storedOps = new Map();
  const customerWrites = [], customerOps = new Map();
  let listVersion = 1, customerChange=null, customerConfirmed=true;
  const server = http.createServer(async (req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
    if(pathname==='/test-qr'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(staffFixture);}
    if(pathname==='/as-app/config.js'){res.setHeader('Content-Type','application/javascript');return res.end(config);}
    if(pathname==='/_local/file'){
      let body='';for await(const part of req)body+=part;
      const width=JSON.parse(body).photoId==='photo-wide'?1600:800;
      res.setHeader('Content-Type','image/svg+xml');
      return res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="800"><rect width="100%" height="100%" fill="#123"/></svg>`);
    }
    if(pathname==='/_local/api'||pathname==='/_local/customer'){
      let body='';for await(const part of req)body+=part;const p=JSON.parse(body);
      if(p.action==='qr_cases'){
        listReads.push(p);
        if(p.offset&&p.listVersion!==listVersion)return json({success:false,code:'LIST_CHANGED'});
        const filtered=cases.filter(c=>p.view.filter==='awaiting'?!c.request.qrIntake.appointmentConfirmed:
          p.view.filter==='confirmed-unassigned'?c.request.qrIntake.appointmentConfirmed&&!c.request.engineer:
          p.view.filter==='changes'?c.changeRequest?.state==='pending':true);
        return json({success:true,admin:true,engineers:['엔지니어 A','엔지니어 B'],ingress:{enabled:true},
          listVersion,items:filtered.slice(p.offset,p.offset+p.limit),total:filtered.length,
          nextOffset:p.offset+p.limit<filtered.length?p.offset+p.limit:null,serviceJobs:[],pushEvents:[]});
      }
      if(p.action==='work_reservation_list')return json({success:true,off:[],schedule:[],slots:[]});
      if(p.action==='qr_update'){
        writes.push(p);
        if(storedOps.has(p.operationId))return json(storedOps.get(p.operationId));
        const row=cases.find(c=>c.request.id===p.requestId);
        if(row.request.revision!==p.baseRevision)return json({success:false,code:'CONFLICT',error:'다른 담당자가 변경했습니다.'});
        Object.assign(row.request,{revision:row.request.revision+1,visitAt:p.startAt??row.request.visitAt,status:p.status,engineer:p.engineer});
        row.request.qrIntake.appointmentConfirmed=!['접수','취소'].includes(p.status)&&!!p.engineer&&(p.status==='방문예정'||row.request.qrIntake.appointmentConfirmed);
        listVersion++;
        storedOps.set(p.operationId,{success:true});
        if(writes.length===1)return json({success:false,retrySameOperation:true,error:'응답 확인 필요'});
        return json({success:true});
      }
      const hospital={id:'test-hospital',name:'테스트 병원'};
      if(p.action==='hospital_info')return json({success:true,hospital});
      if(p.action==='info')return json({success:true,hospital,times:[{startAt:preference}],serverNow:Date.parse('2030-06-17T00:00:00Z')});
      if(p.action==='hospital_entry')return json({success:true,active:false});
      if(p.action==='create'){
        customerWrites.push(p);
        if(customerOps.has(p.operationId))return json(customerOps.get(p.operationId));
        customerOps.set(p.operationId,{success:true,requestId:'fixture-qr-01',requestNumber:'AS-2030-001'});
        return json({success:false,retrySameOperation:true,error:'응답 확인 필요'});
      }
      if(p.action==='change'){
        customerChange={kind:p.kind,state:'pending',note:p.note};
        return json({success:true});
      }
      if(p.action==='status')return json({success:true,request:{id:'fixture-qr-01',requestNumber:'AS-2030-001',
        hospitalId:hospital.id,hospitalName:hospital.name,status:customerConfirmed?'방문예정':'접수',
        visitConfirmed:customerConfirmed,visitAt:customerConfirmed?alternate:'',changeRequest:customerChange,
        preferredStartAts:[preference],contact:{phone:'01000000000'},symptom:'점검 요청'}});
      return json({success:false,error:'테스트에 없는 동작'});
    }
    try{
      const ext=path.extname(pathname), type={'.html':'text/html','.js':'application/javascript','.css':'text/css','.mjs':'application/javascript'}[ext];
      if(type)res.setHeader('Content-Type',type+'; charset=utf-8');
      res.end(await fs.readFile(path.join(root,pathname)));
    }catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  let browser;
  try{
    browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined});
    const staff=await browser.newPage({viewport:{width:390,height:844}});
    staff.setDefaultTimeout(10000);
    staff.on('pageerror',error=>console.error(error.message));
    await staff.goto(origin+'/test-qr');
    await staff.locator('[data-qr-confirm="case-0000"]').click();
    assert.equal(await staff.locator(':focus').getAttribute('id'),'qr-workflow-heading');
    assert.equal(writes.length,0,'list shortcut opens the form without confirming the first preference');
    assert.equal(await staff.locator('.qr-appointment').innerText(),'접수 확인 중');
    const workflowForm=staff.locator('#qr-workflow-form');
    assert.equal(await workflowForm.locator('button[type=submit]').count(),1);
    assert.equal(await staff.locator('#qr-visit-at').inputValue(),'');
    const formLayout=()=>workflowForm.evaluate(form=>[...form.querySelectorAll('.field')].map(field=>Math.round(field.getBoundingClientRect().top)));
    assert.equal(new Set(await formLayout()).size,3,'mobile fields stack vertically');
    await staff.setViewportSize({width:1440,height:900});
    assert.equal(new Set(await formLayout()).size,1,'desktop fields share an aligned row');
    await staff.setViewportSize({width:390,height:844});
    assert.equal(listReads[0].limit,20);
    assert.equal(await staff.locator('[data-qr-select]').count(),20);
    for(const width of [1280,390]){
      await staff.setViewportSize({width,height:844});
      await staff.getByRole('button',{name:'접수 사진 1 확대'}).click();
      const viewport=staff.locator('.qr-photo-viewport');
      const image=staff.locator('#qr-photo-large');
      const geometry=()=>viewport.evaluate(frame=>{
        const imageBox=frame.querySelector('img').getBoundingClientRect(), frameBox=frame.getBoundingClientRect();
        return {centerX:imageBox.x+imageBox.width/2-frameBox.x-frame.clientWidth/2,
          centerY:imageBox.y+imageBox.height/2-frameBox.y-frame.clientHeight/2,
          overflowX:frame.scrollWidth-frame.clientWidth,overflowY:frame.scrollHeight-frame.clientHeight,
          left:frame.scrollLeft,top:frame.scrollTop};
      });
      await image.waitFor({state:'visible'});
      const fitted=await geometry();
      assert.ok(Math.abs(fitted.centerX)<2&&Math.abs(fitted.centerY)<2, 'photo is centered at '+width);
      assert.equal(fitted.overflowX,0);
      assert.equal(fitted.overflowY,0);
      for(let clicks=0;clicks<8;clicks++)await staff.locator('[data-photo-zoom="0.25"]').click();
      const expanded=await geometry();
      assert.ok(expanded.overflowX>0, 'landscape photo scrolls horizontally at '+width);
      if(width===1280)assert.ok(expanded.overflowY>0);
      assert.ok(Math.abs(expanded.centerX)<20&&Math.abs(expanded.centerY)<20, 'zoom starts around center');
      await viewport.evaluate(frame=>frame.scrollTo(frame.scrollWidth,frame.scrollHeight));
      const edge=await geometry();
      assert.equal(edge.left,edge.overflowX);
      assert.equal(edge.top,edge.overflowY);
      await staff.locator('[data-photo-step="1"]').click();
      await staff.waitForFunction(()=>document.querySelector('#qr-photo-large').naturalWidth===800);
      const next=await geometry();
      assert.ok(Math.abs(next.centerX)<2&&Math.abs(next.centerY)<2, 'next photo resets the zoom');
      if(width===390){
        for(let clicks=0;clicks<8;clicks++)await staff.locator('[data-photo-zoom="0.25"]').click();
        const square=await geometry();
        assert.ok(square.overflowX>0&&square.overflowY>0, 'enlarged square photo scrolls in both axes on mobile');
      }
      await staff.keyboard.press('Escape');
      await staff.locator('#qr-photo-viewer').waitFor({state:'hidden'});
    }
    await staff.locator('#qr-visit-at').fill(alternate);
    await staff.locator('#qr-save-all').click();
    assert.match(await staff.locator('#qr-save-feedback').innerText(),/담당 엔지니어를 선택/);
    assert.equal(writes.length,0);
    await staff.locator('#qr-assigned-engineer').selectOption('엔지니어 A');
    await staff.locator('#qr-save-all').click();
    await staff.locator('#qr-workflow-message').filter({hasText:'같은 기록'}).waitFor().catch(async error=>{
      console.error({message:await staff.locator('#qr-workflow-message').textContent(),writes:writes.length,
        form:await staff.locator('#qr-save-all').evaluate(button=>({valid:button.form?.checkValidity(),html:button.outerHTML}))});
      throw error;
    });
    assert.equal(writes[0].status,'방문예정');
    assert.equal(writes[0].startAt,alternate);
    await staff.locator('#qr-retry').click();
    await staff.locator('.qr-appointment').filter({hasText:'14:00'}).waitFor();
    assert.equal(writes[1].operationId,writes[0].operationId);
    assert.equal(storedOps.size,1);
    assert.equal(cases[0].request.revision,2);
    assert.equal(await staff.locator('[data-qr-confirm="case-0000"]').count(),0);
    await staff.locator('#qr-visit-at').fill(preference);
    await staff.locator('#qr-assigned-engineer').selectOption('엔지니어 B');
    await staff.locator('#qr-status').selectOption('처리중');
    await staff.locator('#qr-save-all').click();
    await staff.locator('.qr-appointment').filter({hasText:'10:00'}).waitFor();
    assert.deepEqual([writes[2].startAt,writes[2].engineer,writes[2].status],[preference,'엔지니어 B','처리중']);
    await staff.locator('#qr-status').selectOption('결과확인');
    await staff.locator('#qr-save-all').click();
    await staff.locator('.qr-case-heading .qr-state').filter({hasText:'결과확인'}).waitFor();
    assert.equal(writes[3].startAt,undefined,'status-only save leaves the confirmed date intact');
    await staff.locator('#qr-list-back').click();
    await staff.locator('[data-qr-select="case-0001"]').click();
    await staff.locator('[data-preference="0"]').click();
    await staff.locator('#qr-assigned-engineer').selectOption('엔지니어 A');
    await staff.locator('#qr-save-all').click();
    await staff.locator('.qr-appointment').filter({hasText:'10:00'}).waitFor();
    assert.equal(writes[4].status,'방문예정');
    assert.equal(writes[4].startAt,preference);
    await staff.locator('#qr-list-back').click();
    await staff.locator('[data-filter="confirmed-unassigned"]').click();
    await staff.locator('[data-qr-select="later-confirmed"]').waitFor();
    assert.equal(listReads.at(-1).view.filter,'confirmed-unassigned');
    await staff.locator('[data-filter="awaiting"]').click();
    await staff.locator('[data-qr-select="case-0002"]').waitFor();
    assert.equal(await staff.locator('[data-qr-select="later-confirmed"]').count(),0);
    await staff.locator('[data-filter="changes"]').click();
    await staff.locator('[data-qr-select="case-0021"]').click();
    await staff.getByRole('button',{name:'접수 취소 확정'}).waitFor();
    assert.equal(await staff.locator('#qr-adjust-save').count(),0);

    const phone=await browser.newPage({viewport:{width:390,height:844}});
    phone.setDefaultTimeout(10000);
    phone.on('pageerror',error=>console.error(error.message));
    await phone.goto(origin+'/as-app/as-request.html?hospital=test-hospital');
    await phone.locator('#symptom').fill('점검 요청');
    await phone.locator('#phone').fill('01000000000');
    await phone.locator('#times input[value="'+preference+'"]').check();
    await phone.locator('#submit-request').click();
    await phone.locator('#message').filter({hasText:'전송 결과 확인 중'}).waitFor();
    await phone.reload();
    await phone.locator('#retry-create').click();
    await phone.locator('#status-facts').filter({hasText:'AS-2030-001'}).waitFor();
    assert.equal(customerWrites[1].operationId,customerWrites[0].operationId);
    assert.equal(customerOps.size,1);
    assert.match(await phone.locator('#status-facts').innerText(),/확정 방문/);
    customerConfirmed=false;
    await phone.reload();
    await phone.locator('#request-state').filter({hasText:'접수 확인 중'}).waitFor();
    assert.doesNotMatch(await phone.locator('#status-facts').innerText(),/확정 방문|10:00/);
    await phone.locator('#change-section summary').click();
    await phone.locator('#change-kind').selectOption('cancel');
    await phone.locator('#change-note').fill('테스트 취소 사유');
    await phone.getByRole('button',{name:'요청하기'}).click();
    await phone.locator('#change-state').filter({hasText:'취소 요청이 접수되었습니다'}).waitFor();
    assert.equal(await phone.locator('#change-form').isVisible(),false);
    await phone.reload();
    await phone.locator('#change-section summary').filter({hasText:'취소 요청 · CS 확인 대기'}).waitFor();
    console.log('QR photo centering and scroll, intake recovery, visit confirmation and 10,000-case paging passed');
  }finally{
    await browser?.close();
    await new Promise(resolve=>server.close(resolve));
  }
}

run().catch(err=>{console.error(err);process.exitCode=1;});
