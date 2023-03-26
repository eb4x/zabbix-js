var Kube = {
    params: {},

    setParams: function (params) {
        if (typeof (params) !== 'object') {
            throw new Error('No params object.');
        }

        ['api_token', 'api_url', 'kubelet_scheme', 'kubelet_port'].forEach(function (field) {
            if (!params[field]) {
                throw new Error('Required param "' + field + '" is not set.');
            }
        });

        Kube.params = params;

        /* This regex can be broken down into the following components
         *
         * (?:(?<scheme>https?):\/\/)
         * (?<host>[^:/]+)
         * (?::(?<port>\d+))
         */
        const match = Kube.params.api_url.match(/(?:(https?):\/\/)([^:/]+)(?::(\d+))/);
        if (!match) {
            Zabbix.log(4, '[ Kubernetes ] Received incorrect Kubernetes API url: ' + Kube.params.api_url + '. Expected format: <scheme>://<host>:<port>');
            throw new Error('Cannot get hostname from Kubernetes API url. Check debug log for more information.');
        }

        Kube.params.api_hostname = match[2];
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
            throw new Error('Request failed with unexpected status code. Check debug log for more information.');
        }

        if (response) {
            try {
                response = JSON.parse(response);
            } catch (error) {
                Zabbix.log(2, 'Failed to parse response received from Kubernetes API. Check debug log for more information.');
                throw error;
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
            throw new Error('Cannot get nodes from Kubernetes API. Check debug log for more information.');
        }

        return result.response.items;
    },
};

try {
    Kube.setParams(JSON.parse(value));

    const nodes = Kube.getNodes();

    const isIPv4 = /(\d+\.){3}\d+/;

    const kubeNodes = nodes.map(function (node) {
        var internalIPs = node.status.addresses.filter(function (addr) {
            return addr.type === 'InternalIP';
        });

        var internalIP = internalIPs.length && internalIPs[0].address;

        return {
            '{#NAME}': node.metadata.name,
            '{#IP}': internalIP,
            '{#KUBE.KUBELET.URL}': Kube.params.kubelet_scheme + '://' + (isIPv4.test(internalIP) ? internalIP : '['+internalIP+']') + ':' + Kube.params.kubelet_port,
            '{#COMPONENT}': 'Kubelet',
            '{#CLUSTER_HOSTNAME}': Kube.params.api_hostname
        };
    });

    return JSON.stringify(kubeNodes);
}
catch (error) {
    Zabbix.log(2, '[ Kubernetes ] ERROR: ' + error);
    throw error;
}
