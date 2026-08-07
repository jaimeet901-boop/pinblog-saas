/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_834011533")

  // update field
  collection.fields.addAt(3, new Field({
    "help": "",
    "hidden": false,
    "id": "select2467634050",
    "maxSelect": 1,
    "name": "event_type",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "select",
    "values": [
      "upgrade",
      "downgrade",
      "trial_start",
      "trial_end",
      "plan_assign",
      "reset",
      "suspend",
      "unsuspend",
      "topup",
      "renewed",
      "cancelled",
      "payment_failed",
      "credits_purchased",
      "credits_expired",
      "manual_adjustment",
      "grace_start",
      "grace_end"
    ]
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_834011533")

  // update field
  collection.fields.addAt(3, new Field({
    "help": "",
    "hidden": false,
    "id": "select2467634050",
    "maxSelect": 1,
    "name": "event_type",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "select",
    "values": [
      "upgrade",
      "downgrade",
      "trial_start",
      "trial_end",
      "plan_assign",
      "reset",
      "suspend",
      "unsuspend",
      "topup"
    ]
  }))

  return app.save(collection)
})
