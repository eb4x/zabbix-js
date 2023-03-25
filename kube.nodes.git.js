var Kube = {
      params: {},
      pods_limit: 1000,

      setParams: function (params) {
          ['api_token', 'api_url', 'endpoint_name'].forEach(function (field) {
              if (typeof params !== 'object' || typeof params[field] === 'undefined'
                  || params[field] === '') {
                  throw 'Required param is not set: "' + field + '".';
              }
          });

          Kube.params = params;
      },

      request: function (query) {
          const request = new HttpRequest();
          request.addHeader('Content-Type: application/json');
          request.addHeader('Authorization: Bearer ' + Kube.params.api_token);

          const url = Kube.params.api_url + query;
          Zabbix.log(4, '[ Kubernetes ] Sending request: ' + url);

          var response = request.get(url);
          Zabbix.log(4, '[ Kubernetes ] Received response with status code ' + request.getStatus());
          Zabbix.log(5, response);

          if (request.getStatus() < 200 || request.getStatus() >= 300) {
              throw 'Request failed with status code ' + request.getStatus() + ': ' + response;
          }

          if (response) {
              try {
                  response = JSON.parse(response);
              }
              catch (error) {
                  throw 'Failed to parse response received from Kubernetes API. Check debug log for more information.';
              }
          }

          return {
              status: request.getStatus(),
              response: response
          };
      },

      getNodes: function () {
          var result = Kube.request('/api/v1/nodes');

          if (typeof result.response !== 'object'
              || typeof result.response.items === 'undefined'
              || result.status != 200) {
              throw 'Cannot get nodes from Kubernetes API. Check debug log for more information.';
          }

          return result.response.items;
      },

      getPods: function () {
          var result = [],
              continue_token;

          while (continue_token !== '') {
              var data = Kube.request('/api/v1/pods?limit=' + Kube.pods_limit
                  + ((typeof continue_token !== 'undefined') ? '&continue=' + continue_token : ''));

              if (typeof data.response !== 'object'
                  || typeof data.response.items === 'undefined'
                  || data.status != 200) {
                  throw 'Cannot get pods from Kubernetes API. Check debug log for more information.';
              };

              result.push.apply(result, data.response.items);
              continue_token = data.response.metadata.continue || '';
          }

          return result;
      },

      getEndpointIPs: function () {
          var result = Kube.request('/api/v1/endpoints');
          if (typeof result.response !== 'object'
              || typeof result.response.items === 'undefined'
              || result.status != 200) {
              throw 'Cannot get endpoints from Kubernetes API. Check debug log for more information.';
          };

          const epIPs = {};
          result.response.items.forEach(function (ep) {
              if (ep.metadata.name !== Kube.params.endpoint_name) {
                  return;
              }
              if (!Array.isArray(ep.subsets)) {
                  return;
              }

              ep.subsets.forEach(function (subset) {
                  if (!Array.isArray(subset.addresses)) {
                      return;
                  }

                  subset.addresses.forEach(function (addr) {
                      epIPs[addr.ip] = '';
                  });
              });
          });

          return epIPs;
      }
  },

      Fmt = {
          factors: {
              Ki: 1024, K: 1000,
              Mi: 1024 ** 2, M: 1000 ** 2,
              Gi: 1024 ** 3, G: 1000 ** 3,
              Ti: 1024 ** 4, T: 1000 ** 4,
          },

          cpuFormat: function (cpu) {
              if (typeof cpu === 'undefined') {
                  return 0;
              }

              if (cpu.indexOf('m') > -1) {
                  return parseInt(cpu) / 1000;
              }

              return parseInt(cpu);
          },

          memoryFormat: function (mem) {
              if (typeof mem === 'undefined') {
                  return 0;
              }

              var pair,
                  factor;

              if (pair = mem.match(/(\d+)(\w*)/)) {
                  if (factor = Fmt.factors[pair[2]]) {
                      return parseInt(pair[1]) * factor;
                  }

                  return mem;
              }

              return parseInt(mem);
          }

      }

  try {
      Kube.setParams(JSON.parse(value));

      var nodes = Kube.getNodes(),
          pods = Kube.getPods(),
          epIPs = Kube.getEndpointIPs();

      for (idx in nodes) {
          var internalIP,
              nodePodsCount = 0,
              nodePods = [],
              roles = [];

          Object.keys(nodes[idx].metadata.labels).forEach(function (label) {
              var splitLabel = label.match(/^node-role.kubernetes.io\/([\w\.-]+)/);

              if (splitLabel) {
                  roles.push(splitLabel[1]);
              }
          });

          var internalIPs = nodes[idx].status.addresses.filter(function (addr) {
              return addr.type === 'InternalIP';
          });

          var internalIP = internalIPs.length && internalIPs[0].address;

          pods.forEach(function (pod) {
              if (pod.status.hostIP !== internalIP) {
                  return;
              }

              var containers = {
                  limits: { cpu: 0, memory: 0 },
                  requests: { cpu: 0, memory: 0 },
                  restartCount: 0
              }

              pod.spec.containers.forEach(function (container) {
                  var limits = container.resources.limits,
                      requests = container.resources.requests;

                  nodePodsCount++;

                  if (typeof limits !== 'undefined') {
                      containers.limits.cpu += Fmt.cpuFormat(limits.cpu);
                      containers.limits.memory += Fmt.memoryFormat(limits.memory);
                  }

                  if (typeof requests !== 'undefined') {
                      containers.requests.cpu += Fmt.cpuFormat(requests.cpu);
                      containers.requests.memory += Fmt.memoryFormat(requests.memory);
                  }
              });

              pod.status.containerStatuses.forEach(function (container) {
                  containers.restartCount += container.restartCount;
              });

              nodePods.push({
                  name: pod.metadata.name,
                  namespace: pod.metadata.namespace,
                  labels: pod.metadata.labels,
                  annotations: pod.metadata.annotations,
                  phase: pod.status.phase,
                  conditions: pod.status.conditions,
                  startTime: pod.status.startTime,
                  containers: containers
              });
          });

          delete nodes[idx].metadata.managedFields;
          delete nodes[idx].status.images;

          nodes[idx].status.capacity.cpu = Fmt.cpuFormat(nodes[idx].status.capacity.cpu);
          nodes[idx].status.capacity.memory = Fmt.memoryFormat(nodes[idx].status.capacity.memory);
          nodes[idx].status.allocatable.cpu = Fmt.cpuFormat(nodes[idx].status.allocatable.cpu);
          nodes[idx].status.allocatable.memory = Fmt.memoryFormat(nodes[idx].status.allocatable.memory);

          nodes[idx].status.podsCount = nodePodsCount;
          nodes[idx].status.roles = roles.join(', ');
          nodes[idx].pods = nodePods;
      }

      return JSON.stringify({ nodes: nodes, endpointIPs: epIPs });
  }
  catch (error) {
      error += (String(error).endsWith('.')) ? '' : '.';
      Zabbix.log(3, '[ Kubernetes ] ERROR: ' + error);
      return JSON.stringify({ error: error });
  }
