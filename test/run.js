// Everything in this file uses child processes, because we're
// testing a command line utility.

var chain = require("slide").chain
var child_process = require("child_process")
var path = require("path")
  , testdir = __dirname
  , fs = require("graceful-fs")
  , npmpkg = path.dirname(testdir)
  , npmcli = path.join(__dirname, "bin", "npm-cli.js")

var temp = process.env.TMPDIR
         || process.env.TMP
         || process.env.TEMP
         || ( process.platform === "win32"
            ? "c:\\windows\\temp"
            : "/tmp" )
temp = path.resolve(temp, "npm-test-" + process.pid)

var root = path.resolve(temp, "root")

var failures = 0
  , mkdir = require("mkdirp")
  , rimraf = require("rimraf")

var pathEnvSplit = process.platform === "win32" ? ";" : ":"
  , pathEnv = process.env.PATH.split(pathEnvSplit)

pathEnv.push( process.platform === "win32" ? root
                                           : path.join(root, "bin")
            , path.join(root, "node_modules", ".bin") )

// the env for all the test installs etc.
var env = {}
Object.keys(process.env).forEach(function (i) {
  env[i] = process.env[i]
})
env.npm_config_prefix = root
env.npm_config_color = "always"
env.npm_config_global = "true"
// have to set this to false, or it'll try to test itself forever
env.npm_config_npat = "false"
env.PATH = pathEnv.join(pathEnvSplit)
env.NODE_PATH = path.join(root, "node_modules")



function cleanup (cb) {
  if (failures !== 0) return
  rimraf(root, function (er) {
    if (er) cb(er)
    mkdir(root, 0755, cb)
  })
}

function prefix (content, pref) {
  return pref + (content.trim().split(/\r?\n/).join("\n" + pref))
}

var execCount = 0
function exec (cmd, shouldFail, cb) {
  if (typeof shouldFail === "function") {
    cb = shouldFail, shouldFail = false
  }
  console.error("\n+"+cmd + (shouldFail ? " (expect failure)" : ""))

  // XXX DEBUGGING
  // cmd = "echo RUN "+cmd
  // shouldFail = false

  child_process.exec(cmd, {env: env}, function (er, stdout, stderr) {
    if (stdout) {
      console.error(prefix(stdout, " 1> "))
    }
    if (stderr) {
      console.error(prefix(stderr, " 2> "))
    }

    execCount ++
    if (!shouldFail && !er || shouldFail && er) {
      // stdout = (""+stdout).trim()
      console.log("ok " + execCount + " " + cmd)
      return cb()
    } else {
      console.log("not ok " + execCount + " " + cmd)
      cb(new Error("failed "+cmd))
    }
  })
}

function execChain (cmds, cb) {
  chain(cmds.reduce(function (l, r) {
    return l.concat(r)
  }, []).map(function (cmd) {
    return [exec, cmd]
  }), cb)
}

function flatten (arr) {
  return arr.reduce(function (l, r) {
    return l.concat(r)
  }, [])
}

function setup (cb) {
  cleanup(function (er) {
    if (er) return cb(er)
    execChain(["node \""+path.resolve(npmpkg, "bin", "npm-cli.js")
              + "\" install \""+npmpkg+"\""
              ,"npm config set package-config:foo boo"
              ], cb)
  })
}

function main (cb) {
  console.log("# testing in %s", temp)
  console.log("# global prefix = %s", root)



  failures = 0

  process.chdir(testdir)

  // get the list of packages
  var packages = fs.readdirSync(path.resolve(testdir, "packages"))
  packages = packages.filter(function (p) {
    return p && !p.match(/^\./)
  })

  installAllThenTestAll()

  function installAllThenTestAll () {
    chain
      ( [ setup
        , [ exec, "npm install "+npmpkg ]
        , [ execChain, packages.map(function (p) {
              return "npm install packages/"+p
            }) ]
        , [ execChain, packages.map(function (p) {
              return "npm test "+p
            }) ]
        , [ execChain, packages.concat("npm").map(function (p) {
              return "npm rm " + p
            }) ]
        , installAndTestEach
        ]
      , cb
      )
  }

  function installAndTestEach (cb) {
    chain
      ( [ setup
        , [ execChain, packages.map(function (p) {
              return [ "npm install packages/"+p
                     , "npm test "+p
                     , "npm rm "+p ]
            }) ]
        , [exec, "npm rm npm"]
        , publishTest
        ], cb )
  }

  function publishTest (cb) {
    if (process.env.npm_package_config_publishtest !== "true") {
      console.error("To test publishing: "+
                    "npm config set npm:publishtest true")
      return cb()
    }

    chain
      ( [ setup
        , [ execChain, packages.filter(function (p) {
              return !p.match(/private/)
            }).map(function (p) {
              return [ "npm publish packages/"+p
                     , "npm install "+p
                     , "npm unpublish "+p+" --force"
                     ]
            }) ]
        , publishPrivateTest
        ], cb )

  }

  function publishPrivateTest (cb) {
    exec("npm publish packages/npm-test-private -s", true, function (er) {
      if (er) {
        exec( "npm unpublish npm-test-private --force"
            , function (e2) {
          cb(er || e2)
        })
      }
      cleanup(cb)
    })
  }
}

main(function (er) {
  console.log("1.." + execCount)
  if (er) throw er
})







// First, install npm into a temporary global root.
// Put that on the PATH for all child processes.
//
// Then, for each of the packages in test/packages/*,
// do the following in the test root:
//
// 1. install the package
// 2. uninstall the package
// 3. link the package
// 4. uninstall the package
