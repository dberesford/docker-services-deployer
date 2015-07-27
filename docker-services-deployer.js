#!/usr/bin/env node
// docker api: https://docs.docker.com/reference/api/docker_remote_api_v1.19/
var util = require('util');
var Docker = require('dockerode');
var debug = require('debug')('docker-service-deployer');
var async = require('async');
var _ = require('lodash');
var url = require('url');
var request = require('request');

function main (cfg, cb) {
  var docker = new Docker(cfg.docker);

  function pullImages (services, cb) {
    async.mapSeries(services, pullImage, cb);
  }

  function pullImage (service, cb) {
    if (!service.tag) return cb(new Error('No service \'tag\': ' + util.inspect(service)));
    if (!service.registry) return cb(new Error('No service \'registry\': ' + util.inspect(service)));

    var image = service.registry + ':' + service.tag;
    console.log('Pulling: ', image);
    docker.pull(image, function (err, stream) {
      if (err) return cb(err);
      docker.modem.followProgress(stream, onFinished, onProgress);

      function onFinished (err, output) {
        if (err) return cb(err);

        debug('output', output);
        var last = _.last(output);
        debug('last', last);
        if (last.errorDetail) return cb(last);

        // TODO - YUCK - has to be a better way of doing this
        cb(err, last.status.indexOf('Image is up to date') === -1);
      }

      function onProgress (event) {
        debug('onProgress', event);
        process.stdout.write('.');
      }
    });
  }

  function checkContainers (services, cb) {
    async.mapSeries(services, checkContainer, function (err, containers) {
      if (err) return cb(err);
      async.mapSeries(containers, checkRunning, cb);
    });
  }

  function checkRunning (container, cb) {
    debug('checkRunning:', container);
    container.start(function (err) {
      if (err) {
        if (err.statusCode === 304) return cb();
        return cb(err);
      }
      return cb();
    });
  }

  function checkContainer (service, cb) {
    getContainer(service, function (err, container) {
      if (err) return cb(err);
      debug('checking container:', container, 'for service:', service.name);
      if (!container) return createContainer(service, cb);
      return cb(null, container);
    });
  }

  function reCreateContainers (services, cb) {
    debug('recreating services:', services);
    async.mapSeries(services, reCreateContainer, cb);
  }

  function reCreateContainer (service, cb) {
    console.log('Re-creating container for service: ', service);
    async.waterfall([
      function (cb) {
        getContainer(service, cb);
      },
      function (container, cb) {
        if (!container) return cb(null, container);
        debug('stopping container', container);
        container.stop(function (err) {
          if (err) {
            if (err.statusCode === 304) return cb(null, container); // already stopped
            return cb(err);
          }
          return cb(null, container);
        });
      },
      function (container, cb) {
        if (!container) return cb();
        container.remove(function (err) {
          if (err) return cb(err);
          return cb();
        });
      },
      function (cb) {
        createContainer(service, cb);
      }
    ], cb);
  }

  function getContainer (service, cb) {
    docker.listContainers({all: 1}, function (err, containers) {
      if (err) return cb(err);
      var container = _.find(containers, function (cont) {
        return _.contains(cont.Names, '/' + service.name);
      });
      debug('got container: ', container, ' for service:', service.name);
      if (!container) return cb(null, null);
      return cb(null, docker.getContainer(container.Id));
    });
  }

  function createContainer (service, cb) {
    addHostIp(service.env);
    var image = service.registry;
    var opts = {
      Image: image + ':' + service.tag,
      Cmd: service.cmd,
      name: service.name,
      Env: service.env,
      ExposedPorts: {},
      HostConfig: {
        PortBindings: {}
      },
      RestartPolicy: {
        Name: 'always',
        MaximumRetryCount: 5
      }
    };

    if (service.port) {
      opts.ExposedPorts[service.port + '/tcp'] = {};
      opts.HostConfig.PortBindings[service.port + '/tcp'] = [{ HostPort: '' + service.port }];
    }

    if (service.links) {
      opts.HostConfig.Links = service.links;
    }
    console.log('Creating container: ', opts);
    docker.createContainer(opts, cb);
  }

  async.waterfall([
    function pull (cb) {
      pullImages(cfg.services, function (err, results) {
        if (err) return cb(err);
        var servicesNewImages = _.filter(cfg.services, function (service, index) {
                          return results[index] === true;
                        });
        debug('new images', servicesNewImages);
        return cb(null, servicesNewImages);
      });
    },
    function recreateContainers (servicesNewImages, cb) {
      reCreateContainers(servicesNewImages, function (err) {
        if (err) return cb(err);
        return cb();
      });
    },
    function checkAllContainers (cb) {
      checkContainers(cfg.services, cb);
    }
  ], cb);
};

function addHostIp(env) {
  var os = require('os');
  var ifaces = os.networkInterfaces();
  var hostIp;
  var eth0 = ifaces['eth0'] || ifaces['en0'];
  if (eth0) {
    var v4 = _.findWhere(eth0, {family: 'IPv4'});
    if (v4) {
      hostIp = v4.address;
    }
  }
  if (hostIp) {
    debug('addHostIp:', hostIp);
    env.push('DOCKER_HOST_IP=' + hostIp);
  }
}

var argv = require('minimist')(process.argv.slice(2));
var servicesFile = argv._[0];
if (!servicesFile) {
  console.error('Usage: docker-services-deployer <services-file>');
  process.exit(1);
}

// load the config json file, can be a remote url
function loadConfigFile (file, cb) {
  var u = url.parse(file);
  if (!u.host) return cb(null, require(file));

  request.get(file, function (err, resp, data) {
    if (err) return cb(err + ' - ' + data);
    if (resp.statusCode !== 200) return cb('Invalid response: ' + data);
    var cfg;
    try {
      cfg = JSON.parse(data);
    }catch(x) {
      return cb('Error parsing: ' + file + ' - ' + x);
    }
    return cb(null, cfg);
  });
}

loadConfigFile(servicesFile, function (err, cfg) {
  if (err) return console.error(err);
  debug('cfg', cfg);
  main(cfg, function (err, results) {
    if (err) console.error('ERROR: ', err);
    process.exit();
  });
});
