import {test,expect} from 'bun:test';
import {pinRows} from './pin-layout';
test('one through ten pins fill balanced rows with a six-pin capacity',()=>{
 expect(Array.from({length:10},(_,i)=>pinRows(i+1))).toEqual([[1],[2],[3],[4],[5],[6],[4,3],[4,4],[5,4],[5,5]]);
});
test('narrow sidebars balance within their available capacity',()=>{
 expect(pinRows(7,3)).toEqual([3,2,2]);expect(pinRows(10,2)).toEqual([2,2,2,2,2]);expect(pinRows(0)).toEqual([]);
});
