const assert = require('node:assert/strict')
require('ts-node').register({ project: 'tsconfig.nest.json', transpileOnly: true })
const { buildApprovalEmail, buildOrderStatusEmail } = require('../src-nest/orders/order-approval.template')
const { OrdersService } = require('../src-nest/orders/orders.service')
const { OrderApprovalEmailService } = require('../src-nest/orders/order-approval-email.service')

async function main() {
  const order = { id:'qa', code:'QA-1', status:'pendiente', customerName:'<script>QA</script>', customerEmail:'qa@example.com', items:[{productName:'Rodillera',selectedColor:'Negro',quantity:2,unitPrice:20000,subtotal:40000,image:'https://example.com/photo.jpg'}], total:48400,taxAmount:8400,shippingCost:0,paymentMethod:'cash',shipping:{address:'Local'} }
  const email=buildApprovalEmail(order)
  assert.match(email.html,/&lt;script&gt;/); assert.doesNotMatch(email.html,/<script>/)
  assert.match(email.html,/<img/); assert.match(email.text,/Negro/); assert.match(email.text,/48.400/)
  assert.equal(email.to[0],'qa@example.com')
  assert.equal(buildApprovalEmail({...order,customerEmail:'',user:{name:'Cuenta',email:'cuenta@example.com'}}).to[0],'cuenta@example.com')
  const shipped=buildOrderStatusEmail(order,'shipped'), delivered=buildOrderStatusEmail(order,'delivered')
  assert.match(shipped.subject,/fue enviado/); assert.match(shipped.html,/está en camino/)
  assert.doesNotMatch(shipped.text,/ya estamos preparando|no indica que ya fue despachado/)
  assert.match(delivered.subject,/fue entregado/); assert.match(delivered.html,/Registramos la entrega/)
  assert.doesNotMatch(delivered.text,/está en camino|entrega todavía está pendiente/)
  let queued=0, logs=0
  const notifications=new Map()
  const tx={
    order:{findUnique:async()=>({...order}),findUniqueOrThrow:async()=>({...order}),updateMany:async({data})=>{order.status=data.status;return {count:1}}},
    orderApprovalEmail:{upsert:async({create})=>{const key=create.orderId+'/'+create.kind;if(!notifications.has(key)){notifications.set(key,create);queued++}},updateMany:async()=>({count:0})},
    activityLog:{create:async()=>{logs++}},
  }
  const service=new OrdersService({user:{findUnique:async()=>({id:'admin',role:'admin',active:true})},$transaction:fn=>fn(tx)},null,null)
  await assert.rejects(()=>service.updateStatus('qa','invalido','admin'),/inválido/)
  await service.updateStatus('qa','en preparacion','admin'); assert.equal(order.status,'en_preparacion'); assert.equal(queued,1)
  await service.updateStatus('qa','en preparacion','admin'); assert.equal(logs,1)
  await service.updateStatus('qa','pendiente','admin'); await service.updateStatus('qa','en preparacion','admin'); assert.equal(queued,1)
  await service.updateStatus('qa','enviado','admin'); assert.equal(order.status,'enviado'); assert.equal(queued,2)
  await service.updateStatus('qa','enviado','admin'); assert.equal(queued,2)
  await service.updateStatus('qa','entregado','admin'); assert.equal(order.status,'entregado'); assert.equal(queued,3)
  await service.updateStatus('qa','entregado','admin'); assert.equal(queued,3)
  await assert.rejects(()=>service.updateStatus('qa','enviado','admin'),/cerrado/); assert.equal(queued,3)
  assert.match(notifications.get('qa/shipped').payload.subject,/fue enviado/)
  assert.match(notifications.get('qa/delivered').payload.subject,/fue entregado/)
  order.status='pendiente'; tx.order.updateMany=async()=>({count:0}); await assert.rejects(()=>service.updateStatus('qa','aprobado','admin'),/cambió/)
  const row={id:'mail',orderId:'qa',kind:'approval',payload:email,status:'pending',attempts:0,firstAttemptAt:null,nextAttemptAt:new Date(0)}
  let calls=0
  const prisma={orderApprovalEmail:{
    findFirst:async()=>['pending','sending'].includes(row.status)?{...row}:null,
    updateMany:async({data})=>{Object.assign(row,data,{attempts:row.attempts+1});return {count:1}},
    update:async({data})=>Object.assign(row,data),
  }}
  const worker=new OrderApprovalEmailService(prisma)
  const originalFetch=global.fetch
  const oldKey=process.env.RESEND_API_KEY, oldFrom=process.env.ORDER_EMAIL_FROM
  try {
    delete process.env.RESEND_API_KEY; await worker.drain(); assert.equal(row.attempts,0)
    process.env.RESEND_API_KEY='test-only';process.env.ORDER_EMAIL_FROM='NEZHA <qa@example.com>'
    let firstBody
    global.fetch=async(url,init)=>{calls++;assert.equal(init.headers['Idempotency-Key'],'order-approval/qa'); if(!firstBody)firstBody=init.body;else assert.equal(init.body,firstBody); return {ok:calls>1,status:calls>1?200:503,json:async()=>({id:'provider-id'})}}
    await worker.drain();assert.equal(row.status,'pending');assert.equal(row.attempts,1)
    await worker.drain();assert.equal(row.status,'sent');assert.ok(row.sentAt)
    await worker.drain();assert.equal(calls,2)
    row.status='pending';row.attempts=1;row.firstAttemptAt=new Date(Date.now()-24*3600000)
    await worker.drain();assert.equal(row.status,'failed');assert.equal(calls,2)
    row.status='pending';row.attempts=0;row.firstAttemptAt=null
    const keys=[]
    global.fetch=async(url,init)=>{keys.push(init.headers['Idempotency-Key']);return {ok:true,status:200,json:async()=>({id:'provider-'+row.kind})}}
    for(const kind of ['shipped','delivered']) {
      Object.assign(row,{kind,status:'pending',attempts:0,firstAttemptAt:null,payload:buildOrderStatusEmail(order,kind)})
      await worker.drain(); assert.equal(row.status,'sent')
    }
    assert.deepEqual(keys,['order-shipped/qa','order-delivered/qa'])
    row.status='pending'; row.firstAttemptAt=null; row.attempts=0
    prisma.orderApprovalEmail.updateMany=async()=>({count:0})
    await worker.drain();assert.equal(calls,2)
  } finally {
    global.fetch=originalFetch
    if(oldKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=oldKey
    if(oldFrom===undefined)delete process.env.ORDER_EMAIL_FROM;else process.env.ORDER_EMAIL_FROM=oldFrom
  }
  console.log('PASS: aprobación/envío/entrega, asunto y contenido por estado, invitado/cuenta, estado, concurrencia, deduplicación, fallo/reintento, configuración y ventana de idempotencia. Sin envíos reales.')
}
main().catch(error=>{console.error(error);process.exitCode=1})
