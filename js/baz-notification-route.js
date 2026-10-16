(function(root){
 'use strict';
 var valid=function(v){return /^[A-Za-z0-9_-]{8,90}$/.test(String(v||''));};
 function parse(search){var p=new URLSearchParams(search||'');return valid(p.get('request'))?{requestId:p.get('request'),notificationId:valid(p.get('notification'))?p.get('notification'):''}:null;}
 function url(target){if(target&&!valid(target.requestId)&&valid(target.notificationId))return 'notification.html?notification='+encodeURIComponent(target.notificationId);if(!target||!valid(target.requestId))throw new Error('접수 주소를 확인하세요.');var p=new URLSearchParams({request:target.requestId});if(valid(target.notificationId))p.set('notification',target.notificationId);return 'hospital-work.html?'+p.toString();}
 var api={parse:parse,url:url,valid:valid};if(typeof module==='object'&&module.exports)module.exports=api;else root.BazNotificationRoute=api;
})(typeof window==='object'?window:this);
