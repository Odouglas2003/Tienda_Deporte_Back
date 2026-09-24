const assert = require('node:assert/strict')
require('ts-node').register({ project: 'tsconfig.nest.json', transpileOnly: true })
const { OrdersService } = require('../src-nest/orders/orders.service')
const clone = value => structuredClone(value)
const product = { id:'p1',name:'Rodillera',sku:'BASE',priceRetail:100,priceWholesale:60,discount:10,tax:21,stock:2,images:[],active:true,deletedAt:null,updatedAt:new Date(0),variants:[{sku:'NEGRO',color:'Negro',stock:2,image:'https://example.com/negro.jpg'}] }
const payload = { customer:{firstName:'QA',lastName:'Test',email:'qa@example.com'},paymentMethod:'transfer',items:[{product:'p1',quantity:1,variantSku:'NEGRO'}],shipping:{address:'QA',city:'QA',postalCode:'5000',phone:'000000'} }
function fixture(user=null) {
  let db=clone(product), orders=[], logs=[], seq=0, tail=Promise.resolve()
  const tx={
    product:{updateMany:async({where,data})=>{
      assert.equal(where.active,true); assert.equal(where.deletedAt,null)
      if(db.stock!==where.stock || +db.updatedAt!==+where.updatedAt || JSON.stringify(db.variants)!==JSON.stringify(where.variants.equals)) return {count:0}
      db.stock-=data.stock.decrement; db.variants=clone(data.variants); db.updatedAt=new Date(++seq); return {count:1}
    }},
    order:{create:async({data})=>{ const order={...data,status:'pendiente',id:'o'+orders.length,items:data.items.create};orders.push(order);return order }},
    activityLog:{create:async({data})=>{logs.push(data)}},
  }
  const prisma={user:{findUnique:async()=>user},product:{findMany:async()=>[clone(db)]},settings:{findFirst:async()=>({taxPercentage:21,minWholesaleOrder:0})},
    $transaction:async fn=>{const previous=tail;let release;tail=new Promise(r=>release=r);await previous;const before=clone(db);const beforeOrders=clone(orders);try{return await fn(tx)}catch(e){db=before;orders.splice(0,orders.length,...beforeOrders);throw e}finally{release()}}
  }
  return {service:new OrdersService(prisma,null,{getGeneralRate:async()=>({rate:21})}),prisma,tx,orders,getProduct:()=>db}
}
async function main(){
  let f=fixture();const {order}=await f.service.create(null,clone(payload));assert.equal(order.total,108.9);assert.equal(order.items[0].image,product.variants[0].image);assert.equal(order.items[0].selectedColor,'Negro');assert.equal(f.getProduct().stock,1);assert.equal(f.getProduct().variants[0].stock,1)
  f=fixture();const results=await Promise.allSettled([f.service.create(null,clone(payload)),f.service.create(null,clone(payload))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.orders.length,1);assert.equal(f.getProduct().stock,1);assert.equal(f.getProduct().variants[0].stock,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/stock o el precio cambió/)
  f=fixture();await assert.rejects(()=>f.service.create(null,{...clone(payload),paymentMethod:'check'}),/mayoristas aprobados/);assert.equal(f.orders.length,0)
  await assert.rejects(()=>f.service.create(null,{...clone(payload),paymentMethod:'inventado'}),/medio de pago válido/)
  await assert.rejects(()=>f.service.create(null,{...clone(payload),items:[{product:'p1',quantity:1.5}]}),/Stock insuficiente/)
  await assert.rejects(()=>f.service.create(null,{...clone(payload),items:[{product:'p1',quantity:2,variantSku:'NEGRO'},{product:'p1',quantity:1,variantSku:'NEGRO'}]}),/Stock insuficiente/)
  f=fixture({id:'u',name:'Mayorista',email:'qa@example.com',active:true,accountType:'mayorista',approved:true});assert.equal((await f.service.create({sub:'u'},{...clone(payload),paymentMethod:'check'})).order.total,72.6)
  f=fixture({id:'u',active:false});await assert.rejects(()=>f.service.create({sub:'u'},clone(payload)),/no está habilitada/)
  f=fixture({id:'seller',role:'vendedor',active:true});f.tx.order.findUnique=async()=>({id:'o',status:'pendiente',sellerId:'other'});await assert.rejects(()=>f.service.updateStatus('o','enviado','seller'),/tus clientes/)
  f=fixture();await f.service.create(null,clone(payload));f.prisma.user.findUnique=async()=>({id:'admin',role:'admin',active:true})
  f.tx.order.findUnique=async()=>clone(f.orders[0]);f.tx.order.findUniqueOrThrow=async()=>clone(f.orders[0]);
  f.tx.order.updateMany=async({where,data})=>{if(f.orders[0].status!==where.status)return {count:0};f.orders[0].status=data.status;return {count:1}}
  f.tx.product.findUnique=async()=>clone(f.getProduct())
  let restores=0
  f.tx.product.updateMany=async({where,data})=>{const db=f.getProduct();assert.equal(where.stock,db.stock);assert.deepEqual(where.variants.equals,db.variants);db.stock+=data.stock.increment;db.variants=clone(data.variants);restores++;return {count:1}}
  f.tx.orderApprovalEmail={updateMany:async()=>({count:0})}
  await Promise.all([f.service.updateStatus('o0','cancelado','admin'),f.service.updateStatus('o0','cancelado','admin')]);assert.equal(restores,1);assert.equal(f.getProduct().stock,2);assert.equal(f.getProduct().variants[0].stock,2)
  await assert.rejects(()=>f.service.updateStatus('o0','pendiente','admin'),/cerrado/)
  f.orders[0].status='enviado';await assert.rejects(()=>f.service.updateStatus('o0','cancelado','admin'),/despachado/);assert.equal(restores,1)
  f.orders[0].status='pendiente';f.getProduct().variants[0].sku='CHANGED';await assert.rejects(()=>f.service.updateStatus('o0','rechazado','admin'),/cambió una variante/);assert.equal(f.orders[0].status,'pendiente');assert.equal(restores,1)
  console.log('PASS: compra minorista/mayorista, IVA, foto, stock concurrente, cantidades, medios de pago, vendedor ajeno, cancelación repetida y rollback. Sin base de producción ni pedidos reales.')
}
main().catch(e=>{console.error(e);process.exitCode=1})
