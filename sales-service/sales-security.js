window.BazSalesSecurity = api => {
  const el = id => document.getElementById(id);
  const dialog = el('security-dialog');
  const formatTime = new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'});
  let busy = false, level = 0;

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function button(text, action, className) {
    const element = node('button', text, className);
    element.type = 'button';
    element.onclick = action;
    return element;
  }

  function userCard(user, currentEmail) {
    const card = node('article', '', 'sales-security-card');
    const inactive = user.status === 'disabled';
    const header = node('div','', 'security-person');
    const identity = node('div');
    identity.append(node('strong',user.name || user.email),node('p',user.email,'sales-muted'),
      node('p',[user.linked ? 'Google 연결됨' : '첫 로그인 대기', user.lastLogin && formatTime.format(user.lastLogin)].filter(Boolean).join(' · '),'sales-muted'));
    header.append(identity,node('span',inactive ? '중지' : '사용 중',`security-badge${inactive ? ' security-disabled' : ''}`));

    const actions = node('div','','security-row-actions');
    const permission = node('select');
    permission.setAttribute('aria-label',`${user.name || user.email} 권한`);
    for (const value of [1,2,3]) permission.add(new Option(`Lv.${value}`,String(value),false,value===user.level));
    const save = (status, nextLevel, message) => run('sales_security_save',{email:user.email,level:nextLevel,status},message);
    const saveButton = button('권한 저장',() => save(user.status,Number(permission.value),'권한을 저장했습니다.'),'security-primary');
    const toggle = button(inactive ? '다시 활성화' : '사용 중지',() => {
      if (!inactive && !confirm(`${user.name || user.email} 계정의 사용을 중지할까요?`)) return;
      void save(inactive ? 'active' : 'disabled',user.level,inactive ? '계정을 다시 활성화했습니다.' : '계정 사용을 중지했습니다.');
    }, inactive ? 'security-positive' : 'security-danger');
    const remove = button('삭제',() => {
      if (!confirm(`${user.name || user.email} (${user.email}) 계정을 영업 앱 허용 목록에서 삭제할까요? 기억된 로그인과 기기 알림 연결이 해제됩니다.`)) return;
      void run('sales_security_delete',{email:user.email},'허용 사용자를 삭제했습니다.');
    },'security-danger');
    if (user.email === currentEmail) {
      for (const element of [permission, saveButton, toggle, remove]) element.disabled = true;
    }
    actions.append(permission,saveButton,toggle,remove);
    card.append(header,actions);
    return card;
  }

  function deviceCard(device) {
    const card = node('article','','sales-security-card security-person');
    const info = node('div');
    const metadata = [device.loggedAt && formatTime.format(device.loggedAt),device.ua].filter(Boolean).join(' · ');
    info.append(node('strong',`${device.name || device.email} · Lv.${device.level}`),node('p',device.email,'sales-muted'),node('p',metadata || '기억된 기기','sales-muted'));
    const revoke = button('해지',() => {
      if (confirm('이 기기의 기억된 로그인을 해지할까요?')) void run('sales_security_revoke',{deviceId:device.id},'기기 로그인을 해지했습니다.');
    },'security-danger');
    card.append(info,revoke);
    return card;
  }

  async function run(action = 'sales_security_list', args = {}, message = '') {
    if (busy || level !== 3) return false;
    busy = true;
    el('security-status').textContent = '처리 중…';
    dialog.setAttribute('aria-busy','true');
    try {
      if (action !== 'sales_security_list') await api(action,args);
      const data = await api('sales_security_list');
      if (level !== 3) return false;
      el('security-users').replaceChildren(...data.users.map(user => userCard(user,data.currentEmail)));
      el('security-devices').replaceChildren(...(data.devices.length ? data.devices.map(deviceCard) : [node('p','기억된 기기가 없습니다.','sales-muted')]));
      el('security-status').textContent = message;
      return true;
    } catch (error) {
      el('security-status').textContent = error.message;
      return false;
    } finally {
      busy = false;
      dialog.removeAttribute('aria-busy');
    }
  }

  el('security-open').onclick = () => { dialog.showModal(); void run(); };
  el('security-refresh').onclick = () => run();
  el('security-add').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (await run('sales_security_add',{name:el('security-name').value,email:el('security-email').value,level:Number(el('security-level').value)},'허용 사용자를 추가했습니다.')) form.reset();
  };

  return {setLevel(value) {
    level = Number(value) || 0;
    el('security-open').hidden = level !== 3;
    if (level === 3) return;
    if (dialog.open) dialog.close();
    for (const id of ['security-users','security-devices','security-status']) el(id).replaceChildren();
  }};
};
