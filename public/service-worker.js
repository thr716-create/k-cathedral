self.addEventListener("push",event=>{
  let data={title:"청년회 알림",body:"새로운 소식이 있습니다.",url:"/"};
  try{if(event.data)data={...data,...event.data.json()};}catch{}
  event.waitUntil(self.registration.showNotification(data.title,{body:data.body,icon:"/icon-192.png",data:{url:data.url||"/"}}));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const url=event.notification.data?.url||"/";
  event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{
    for(const client of list){if("focus" in client)return client.navigate(url).then(c=>c?.focus());}
    return clients.openWindow(url);
  }));
});
