import { CLASSROOM_SOURCE } from '../js/schedule.js';
export function scheduleFixture() {
  const dates=Array.from({length:7},(_,i)=>`2026-10-${12+i}`);
  return { source:CLASSROOM_SOURCE, observedAt:'2026-10-12T02:00:00Z', days:dates.map(date=>({date})),truncated:false,
    records:['可用合成教室','占用合成教室','未知合成教室'].map((name,index)=>({name,capacity:40,periods:Array.from({length:42},(_,slot)=>({dayIndex:Math.floor(slot/6),period:slot%6+1,status:index===0?'空闲':index===1?'有课':'待核实'}))})) };
}
