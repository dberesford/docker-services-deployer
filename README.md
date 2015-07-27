# docker-services-deployer

A simple tool for deploying your services to Docker.

## Usage

```
$ npm install -g docker-services-deployer
$ docker-services-deployer <config-file>
```

Note that `<config-file>` can be a local file on disk or a remote url, e.g. a file on S3, an api endpoint, or whatever.

## Config file

There are two parts to the config file, your 'docker' options, and the definition of your services that you want to deploy to docker.

```
{
  docker: {
  },
  services: [{
    "name": "service1",
    "registry": "mydockerregistry.somewhere.com/myorg/service1",
    "tag": "latest"
    "port": 1234,
    "links": ["service2:service2"],
    "cmd": [
      "node",
      "service.js"
      ],
    "env": [
      "FOO=bar",
      "FOO2=bar2"
    ]
  }]
}
```

The `docker` config object gets passed on directly to [dockerode](https://www.npmjs.com/package/dockerode), see there for details.

## What it does / how it works

`docker-services-deployer` connects to docker, and then does the following to make sure docker is running the specified services at the correct version (tag):

* first it checks your service image is up to date by pulling the image from the remote docker registry
* if the image is already up to date, it checks you have a container for that service based off that image and that the container is running
* if pulled image is different, it will stop and remove the existing container for this image (if it exists), and then creates a new container based of the new pulled image and runs it
* the name, port, cmd and env from your service definition are all used when creating a container

## License

MIT

Thanks to [nearForm](http://nearform.com) for sponsoring this.

