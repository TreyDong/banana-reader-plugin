import test from 'node:test';
import assert from 'node:assert/strict';
import {shelfBooks,shelfTitle,columnsFor,chunkRows,spineStyle,formatShelfProgress,type ShelfFile,type ShelfReading} from '../src/bookshelf';

const file=(path:string):ShelfFile=>({path,basename:path.split('/').pop()!,extension:path.split('.').pop()!});

test('shelf ordering puts recently read first, then unread alphabetically',()=>{
 const readings:Record<string,ShelfReading>={'b.pdf':{progress:.5,updated:200},'a.epub':{progress:1,updated:300},'c.md':{progress:.2,updated:100}};
 const books=shelfBooks([file('z.md'),file('b.pdf'),file('a.epub'),file('c.md')],readings);
 assert.deepEqual(books.map(b=>b.path),['a.epub','b.pdf','c.md','z.md']);
 assert.equal(books[2]!.progress,.2);assert.equal(books[3]!.progress,0);
});

test('progress clamps to 0..1 and titles drop known extensions only',()=>{
 assert.deepEqual(shelfBooks([file('x.md')],{'x.md':{progress:5}})[0]!.progress,1);
 assert.equal(shelfTitle('我的书.epub'),'我的书');assert.equal(shelfTitle('notes.MD'),'notes');assert.equal(shelfTitle('v1.2.pdf'),'v1.2');
});

test('row layout derives column counts and chunks deterministically',()=>{
 assert.equal(columnsFor(1000),16);assert.equal(columnsFor(60),2);
 const rows=chunkRows([1,2,3,4,5],2);
 assert.deepEqual(rows,[[1,2],[3,4],[5]]);
 assert.deepEqual(chunkRows([],3),[]);
});

test('spine styles are stable per title, varied across palette and bounded in height',()=>{
 const a=spineStyle('三体'),b=spineStyle('三体'),c=spineStyle('战争与和平');
 assert.deepEqual(a,b);assert.notDeepEqual(a,c);
 assert.ok(a.height>=168&&a.height<=196);
 const seen=new Set(Array.from({length:20},(_,i)=>spineStyle('书'+i).color));
 assert.ok(seen.size>3);
});

test('progress formatting is a bounded integer percentage',()=>{
 assert.equal(formatShelfProgress(.456),46);assert.equal(formatShelfProgress(-1),0);assert.equal(formatShelfProgress(2),100);
});
