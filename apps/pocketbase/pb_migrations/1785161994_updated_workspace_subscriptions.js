/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3777347480")

  // add field
  collection.fields.addAt(23, new Field({
    "help": "",
    "hidden": false,
    "id": "number2969140574",
    "max": null,
    "min": 0,
    "name": "purchased_credits",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(24, new Field({
    "help": "",
    "hidden": false,
    "id": "number4140653218",
    "max": null,
    "min": 0,
    "name": "bonus_credits_balance",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(25, new Field({
    "help": "",
    "hidden": false,
    "id": "number1991848899",
    "max": null,
    "min": 0,
    "name": "credits_used_total",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(26, new Field({
    "help": "",
    "hidden": false,
    "id": "bool3103233500",
    "name": "credits_suspended",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "bool"
  }))

  // add field
  collection.fields.addAt(27, new Field({
    "help": "",
    "hidden": false,
    "id": "date1742660895",
    "max": "",
    "min": "",
    "name": "last_credit_reset_at",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "date"
  }))

  // add field
  collection.fields.addAt(28, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text1054492236",
    "max": 40,
    "min": 0,
    "name": "billing_status",
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
  collection.fields.removeById("number2969140574")

  // remove field
  collection.fields.removeById("number4140653218")

  // remove field
  collection.fields.removeById("number1991848899")

  // remove field
  collection.fields.removeById("bool3103233500")

  // remove field
  collection.fields.removeById("date1742660895")

  // remove field
  collection.fields.removeById("text1054492236")

  return app.save(collection)
})
