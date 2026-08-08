/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3777347480")

  // add field
  collection.fields.addAt(12, new Field({
    "help": "",
    "hidden": false,
    "id": "date746802699",
    "max": "",
    "min": "",
    "name": "trial_ends_at",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "date"
  }))

  // add field
  collection.fields.addAt(13, new Field({
    "help": "",
    "hidden": false,
    "id": "date2031630841",
    "max": "",
    "min": "",
    "name": "grace_period_ends_at",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "date"
  }))

  // add field
  collection.fields.addAt(14, new Field({
    "help": "",
    "hidden": false,
    "id": "bool780795615",
    "name": "cancel_at_period_end",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "bool"
  }))

  // add field
  collection.fields.addAt(15, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text4147967547",
    "max": 64,
    "min": 0,
    "name": "pending_plan",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(16, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text809498382",
    "max": 40,
    "min": 0,
    "name": "last_payment_status",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(17, new Field({
    "help": "",
    "hidden": false,
    "id": "date953766717",
    "max": "",
    "min": "",
    "name": "last_payment_at",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "date"
  }))

  // add field
  collection.fields.addAt(18, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text2462348188",
    "max": 40,
    "min": 0,
    "name": "provider",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(19, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text1112371657",
    "max": 120,
    "min": 0,
    "name": "provider_subscription_id",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(20, new Field({
    "help": "",
    "hidden": false,
    "id": "number1534370511",
    "max": null,
    "min": 0,
    "name": "monthly_credits_balance",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(21, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text13272506",
    "max": 120,
    "min": 0,
    "name": "notified_credit_thresholds",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(22, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text456504793",
    "max": 64,
    "min": 0,
    "name": "owner_user",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3777347480")

  // remove field
  collection.fields.removeById("date746802699")

  // remove field
  collection.fields.removeById("date2031630841")

  // remove field
  collection.fields.removeById("bool780795615")

  // remove field
  collection.fields.removeById("text4147967547")

  // remove field
  collection.fields.removeById("text809498382")

  // remove field
  collection.fields.removeById("date953766717")

  // remove field
  collection.fields.removeById("text2462348188")

  // remove field
  collection.fields.removeById("text1112371657")

  // remove field
  collection.fields.removeById("number1534370511")

  // remove field
  collection.fields.removeById("text13272506")

  // remove field
  collection.fields.removeById("text456504793")

  return app.save(collection)
})
