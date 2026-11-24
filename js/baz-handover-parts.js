(function(root){
  'use strict';

  const baseParts=[
    "내부 세척","Handpiece Ass'y","Foot-SW Ass'y","Foot-SW Connector(장비)",
    "Foot-SW cable","Cradle (거치대)","SD Card",
    "없음","Top Cover Ass'y","Main Board","RFID Module","LCD + Raspberry Pi Ass'y","HP / SD Card",
    "On / Off Swich","On / Off Key","Emergency Switch","Power Adaptor","Power Cable",
    "Water Tank","Water Pump","Caster","Arm","Arm Holder","AC Cord",
    "Nozzle","Nozzle Spanner","Perm-Holder","Piston (V 1.0)","Piston (V 1.1)","Piston (V 1.2)",
    "Bush Bobbin","Spring","Plunger (V 1.2.1)","Plunger (V 1.2.2)","Adaptor(1.0)","Adaptor(1.1)",
    "Damper","Spacer","Wrench Bolt (수평)","Wrench Bolt (수직)","대체장비입고","재체결",
    "Spring(1.0)","Power Key","Plunger(1.2.1)","HP-Cradle Ass'y(거치대)","Adaptor","Holder",
    "Water tank Ass'y","RFID Module A'ssy","Fan","Foot-SW Ass'y (Repair)"
  ];

  function create(select){
    const parts=new Set();
    let savedOption=null;

    function set(value){
      savedOption?.remove();
      savedOption=null;
      if(value&&!parts.has(value)){
        savedOption=new Option(value,value);
        select.add(savedOption);
      }
      select.value=value;
    }

    function merge(items){
      const selected=select.value;
      for(const part of items||[]){
        if(typeof part!=='string'||!part||parts.has(part)) continue;
        parts.add(part);
        select.add(new Option(part,part));
      }
      if(savedOption&&parts.has(savedOption.value)) set(selected);
    }

    merge(baseParts);
    return {merge,set,has:part=>parts.has(part)};
  }

  root.BazHandoverParts={create};
})(globalThis);
