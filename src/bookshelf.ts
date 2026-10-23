/**
 * Pure helpers for the bookshelf view: collecting readable books with their
 * reading progress, laying spines into plank rows and deriving each spine's
 * cloth color and height deterministically from the book title.
 */
export interface ShelfFile{path:string;basename:string;extension:string}
export interface ShelfReading{progress?:number;updated?:number}
export interface ShelfBook{path:string;title:string;extension:string;progress:number;updated:number}
export interface SpineStyle{color:string;dark:string;height:number}

const PALETTE:[string,string][]=[
  ['#9d3b2d','#6f2418'],['#31548c','#1e3560'],['#4d6b3c','#31471f'],['#a06b22','#6f4712'],
  ['#5d3a6e','#3d2350'],['#2e6e6a','#1c4845'],['#8c4a36','#5f2e20'],['#3a4d5d','#24333f'],
  ['#6b6b2e','#47471a'],['#7a2e4a','#521c30']];

export function shelfTitle(basename:string):string{return basename.replace(/\.(md|pdf|epub)$/i,'').trim()||basename;}

/** Recently read first (by last update), then unread books by title. */
export function shelfBooks(files:ShelfFile[],readings:Record<string,ShelfReading>):ShelfBook[]{
 const read:ShelfBook[]=[],unread:ShelfBook[]=[];
 for(const file of files){
  const reading=readings[file.path];
  const progress=reading&&typeof reading.progress==='number'?Math.max(0,Math.min(1,reading.progress)):0;
  const updated=reading&&typeof reading.updated==='number'?reading.updated:0;
  (updated>0?read:unread).push({path:file.path,title:shelfTitle(file.basename),extension:file.extension.toLowerCase(),progress,updated});
 }
 read.sort((a,b)=>b.updated-a.updated||a.title.localeCompare(b.title));
 unread.sort((a,b)=>a.title.localeCompare(b.title));
 return [...read,...unread];
}

/** Spines per plank row for a container width; at least two, so single books still sit on a plank. */
export function columnsFor(width:number,spineWidth=46,gap=14):number{
 return Math.max(2,Math.floor((width+gap)/(spineWidth+gap)));
}

export function chunkRows<T>(items:T[],count:number):T[][]{
 const size=Math.max(1,count),rows:T[][]=[];
 for(let i=0;i<items.length;i+=size)rows.push(items.slice(i,i+size));
 return rows;
}

/** Deterministic cloth color and standing height so the same book always looks the same. */
export function spineStyle(seed:string):SpineStyle{
 let hash=0;for(let i=0;i<seed.length;i++)hash=(hash*31+seed.charCodeAt(i))>>>0;
 const [color,dark]=PALETTE[hash%PALETTE.length]!;
 return{color,dark,height:168+(hash>>>8)%29};
}

export function formatShelfProgress(progress:number):number{return Math.round(Math.max(0,Math.min(1,progress))*100);}
