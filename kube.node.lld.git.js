var Kube = {
    params: {},

    setParams: function (params) {
        ['api_endpoint', 'token', 'kubelet_scheme', 'kubelet_port'].forEach(function (field) {
            if (typeof params !== 'object' || typeof params[field] === 'undefined'
                || params[field] === '') {
                throw 'Required param is not set: "' + field + '".';
            }
        });

        Kube.params = params;
        if (typeof Kube.params.api_endpoint === 'string' && !Kube.params.api_endpoint.endsWith('/')) {
            Kube.params.api_endpoint += '/';
        }
    },

    request: function (query) {
        var response,
            request = new HttpRequest(),
            url = Kube.params.api_endpoint + query;

        request.addHeader('Content-Type: application/json');
        request.addHeader('Authorization: Bearer ' + Kube.params.token);

        Zabbix.log(4, '[ Kubernetes ] Sending request: ' + url);

        response = request.get(url);

        Zabbix.log(4, '[ Kubernetes ] Received response with status code ' + request.getStatus() + ': ' + response);

        if (request.getStatus() < 200 || request.getStatus() >= 300) {
            throw 'Request failed with status code ' + request.getStatus() + ': ' + response;
        }

        if (response !== null) {
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
        var result = Kube.request('v1/nodes');

        if (typeof result.response !== 'object'
            || typeof result.response.items === 'undefined'
            || result.status != 200) {
            throw 'Cannot get nodes from Kubernetes API. Check debug log for more information.';
        };

        return result.response;
    },
};

try {
    Kube.setParams(JSON.parse(value));

    var nodes = Kube.getNodes(),
        kubeNodes = [];
        api_url = 'https://api.okd.slips.pl:6443',
        hostname = api_url.match(/\/\/(.+):/);

    if (typeof hostname[1] === 'undefined') {
          Zabbix.log(4, '[ Kubernetes ] Received incorrect Kubernetes API url: ' + api_url + '. Expected format: <scheme>://<host>:<port>');
          throw 'Cannot get hostname from Kubernetes API url. Check debug log for more information.';
        };
    for (idx in nodes.items) {
        var internalIPs = nodes.items[idx].status.addresses.filter(function (addr) {
            return addr.type === 'InternalIP';
        });

        var internalIP = internalIPs.length && internalIPs[0].address;

        kubeNodes.push({
            '{#NAME}': nodes.items[idx].metadata.name,
            '{#IP}': internalIP,
            '{#KUBE.KUBELET.URL}': Kube.params.kubelet_scheme + '://' + ((/(\d+.){3}\d+/.test(internalIP)) ? internalIP : '['+internalIP+']')  + ':' + Kube.params.kubelet_port,
            '{#COMPONENT}': 'Kubelet',
            '{#CLUSTER_HOSTNAME}': hostname[1]
        });
    }

    return JSON.stringify(kubeNodes);
}
catch (error) {
    error += (String(error).endsWith('.')) ? '' : '.';
    Zabbix.log(3, '[ Kubernetes ] ERROR: ' + error);
    return JSON.stringify({ error: error });
}
