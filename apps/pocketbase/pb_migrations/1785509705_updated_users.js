/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("_pb_users_auth_")

  // update collection data
  unmarshal({
    "createRule": "(@request.body.role:isset = false || @request.body.role = 'member') && (@request.body.plan:isset = false || @request.body.plan = 'free') && @request.body.status:isset = false && @request.body.ai_credits_used:isset = false && @request.body.image_credits_used:isset = false && @request.body.credits:isset = false && (@request.body.verified:isset = false || @request.body.verified = false)",
    "updateRule": "id = @request.auth.id && @request.body.role:isset = false && @request.body.plan:isset = false && @request.body.status:isset = false && @request.body.ai_credits_used:isset = false && @request.body.image_credits_used:isset = false && @request.body.verified:isset = false && @request.body.credits:isset = false"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("_pb_users_auth_")

  // update collection data
  unmarshal({
    "createRule": "",
    "updateRule": "id = @request.auth.id"
  }, collection)

  return app.save(collection)
})
