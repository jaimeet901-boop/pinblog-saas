/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3971868647")

  // add field
  collection.fields.addAt(24, new Field({
    "cascadeDelete": false,
    "collectionId": "pbc_2170078043",
    "help": "",
    "hidden": false,
    "id": "relation2375286809",
    "maxSelect": 1,
    "minSelect": 0,
    "name": "workspace",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  // add field
  collection.fields.addAt(25, new Field({
    "cascadeDelete": false,
    "collectionId": "_pb_users_auth_",
    "help": "",
    "hidden": false,
    "id": "relation3245004474",
    "maxSelect": 1,
    "minSelect": 0,
    "name": "last_edited_by",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3971868647")

  // remove field
  collection.fields.removeById("relation2375286809")

  // remove field
  collection.fields.removeById("relation3245004474")

  return app.save(collection)
})
