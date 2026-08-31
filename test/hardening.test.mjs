import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import sharp from 'sharp';
import {January,JanuaryApiError,JanuaryResponseError,JanuaryValidationError,JanuaryTransportError,
  BadRequestError,AuthenticationError,PermissionDeniedError,NotFoundError,PayloadTooLargeError,
  RateLimitError,CreditLimitExceededError,InternalServerError} from '../dist/index.js';
import {apiErrorType} from '../dist/errors.js';
import {retryableStatus,retryDelay,waitForRetry} from '../dist/retry.js';
import {operations} from '../dist/generated/operations.js';
import {prepareImage} from '../dist/images.js';

test('error classification matches Python: only rate/credit codes override HTTP', async t => {
  for (const [status,expected] of [[400,BadRequestError],[401,AuthenticationError],[403,PermissionDeniedError],[404,NotFoundError],[413,PayloadTooLargeError],[429,RateLimitError],[500,InternalServerError],[502,InternalServerError],[503,InternalServerError],[504,InternalServerError]]) {
    for (const code of [undefined,'future_code','unauthorized','not_found','rate_limited','credit_limit_exceeded']) await t.test(`${status}/${code}`,() => {
      assert.equal(apiErrorType(status,code),code==='rate_limited'?RateLimitError:code==='credit_limit_exceeded'?CreditLimitExceededError:expected);
    });
  }
});

test('bounded code-aware retries and single-request operations',async t => {
  for (const [name,code,maxRetries,want] of [['default','rate_limited',undefined,3],['disabled','rate_limited',0,1],['credits','credit_limit_exceeded',undefined,1],['permanent','not_implemented',undefined,1]]) await t.test(name,async()=>{
    let calls=0;
    const january=new January({secretKey:'sk-test',...(maxRetries===undefined?{}:{maxRetries}),fetch:async()=>{
      calls++;return new Response(JSON.stringify({code,message:'wait'}),{status:429,headers:{'retry-after':'0'}});
    }});
    await assert.rejects(january.credits(),JanuaryApiError);assert.equal(calls,want);
  });
  for (const op of [operations.mintClientToken,operations.createFoodLog,operations.revokeClientTokens]) {
    assert.equal(retryDelay(op,new JanuaryApiError('server',503),0,0),undefined);
  }
  assert.equal(retryDelay(operations.revokeClientTokens,new RateLimitError('rate',429),0,0),undefined);
  for (const status of [400,401,403,404,413,429,500,501,502,503,504]) {
    for (const code of ['credit_limit_exceeded','invalid_request','unauthorized','forbidden','not_found','not_implemented','payload_too_large']) assert.equal(retryableStatus(status,code),false);
  }
  for (const status of [429,500,502,503,504]) assert.equal(retryableStatus(status,'future_code'),true);
});

test('retry budget refusal, deadline, cancellation and response failures',async()=>{
  for (const [ms,waited] of [[61000,0],[40000,30000]]) {
    const error=new RateLimitError('rate',429,'rate_limited',{metadata:{status:429,headers:{},retryAfterMs:ms}});
    assert.equal(retryDelay(operations.searchFoods,error,0,waited),undefined);assert.match(error.retryNote,/60-second/);
  }
  const abort=new AbortController();const waiting=waitForRetry(10000,[abort.signal]);abort.abort();
  await assert.rejects(waiting,e=>e instanceof JanuaryTransportError&&e.code==='canceled');
  let calls=0;
  const client=new January({secretKey:'sk-test',timeoutMs:50,fetch:async()=>{calls++;return new Response('{"code":"rate_limited"}',{status:429,headers:{'retry-after':'1'}});}});
  await assert.rejects(client.credits(),e=>e instanceof RateLimitError&&/deadline/.test(e.retryNote));assert.equal(calls,1);
  const malformed=new January({secretKey:'sk-test',fetch:async()=>new Response('not json')});
  await assert.rejects(malformed.credits(),e=>e instanceof JanuaryResponseError&&!(e instanceof JanuaryApiError));
});

test('error messages are bounded, credentials and body are redacted',async()=>{
  const client=new January({secretKey:'sk-private',fetch:async()=>new Response(JSON.stringify({code:'forbidden',message:'sk-private '.repeat(100)}),{status:403,headers:{'x-request-id':'sk-private'}})});
  await assert.rejects(client.credits(),e=>{
    assert.ok(e instanceof PermissionDeniedError);assert.ok(e.message.length<240);
    assert.ok(!e.body.includes('sk-private'));assert.equal(e.requestId,'[REDACTED]');return true;
  });
});

test('photo input forms preserve compliant bytes and do not fetch URLs',async t=>{
  const bytes=await sharp(await readFile(new URL('../examples/live/food.png',import.meta.url))).resize({width:512}).png().toBuffer();
  const directory=await mkdtemp(join(tmpdir(),'january-images-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const path=join(directory,'food.png');await writeFile(path,bytes);
  const uri=`data:image/png;base64,${bytes.toString('base64')}`;
  for (const [name,input] of [['path',path],['buffer',bytes],['typed array',new Uint8Array(bytes)],['array buffer',Uint8Array.from(bytes).buffer],['blob',new Blob([bytes])],['stream',Readable.from([bytes])],['data URI',uri]]) await t.test(name,async()=>assert.equal(await prepareImage(input),uri));
  assert.equal(await prepareImage('https://example.invalid/food.jpg'),'https://example.invalid/food.jpg');
  for (const input of [Buffer.alloc(0),Buffer.from('invalid'),'file:///private/file',Readable.from(['text'])]) await assert.rejects(prepareImage(input),JanuaryValidationError);
  await assert.rejects(prepareImage(join(directory,'missing')),e=>e.code==='ENOENT');
});

test('photo resizing, white alpha flattening, rotation and byte budget',async()=>{
  const large=await sharp({create:{width:2048,height:1024,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer();
  const uri=await prepareImage(large);assert.match(uri,/^data:image\/jpeg;base64,/);
  const output=Buffer.from(uri.split(',')[1],'base64');const info=await sharp(output).metadata();
  assert.equal(info.width,1024);assert.equal(info.height,512);assert.ok(output.length<3500000);
  const pixel=await sharp(output).extract({left:0,top:0,width:1,height:1}).raw().toBuffer();assert.ok([...pixel].every(n=>n>=250));
  const rotated=await sharp({create:{width:8,height:4,channels:3,background:'#ee8822'}}).jpeg().withMetadata({orientation:6}).toBuffer();
  const upright=await sharp(Buffer.from((await prepareImage(rotated)).split(',')[1],'base64')).metadata();
  assert.equal(upright.width,4);assert.equal(upright.height,8);assert.equal(upright.orientation,undefined);
  assert.match(await prepareImage(large,{preprocess:false}),/^data:image\/png/);
});
