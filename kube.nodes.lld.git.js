function parseFilters(filter) {
    var pairs = {};

    filter.split(/\s*,\s*/).forEach(function (kv) {
        if (/([\w\.-]+\/[\w\.-]+):\s*.+/.test(kv)) {
            var pair = kv.split(/\s*:\s*/);
            pairs[pair[0]] = pair[1];
        }
    });

    return pairs;
}

function filter(name, data, filters) {
    var filtered = true;

    if (typeof data !== 'object') {
        return filtered;
    }

    Object.keys(filters).some(function (filter) {
        var exclude = filter.match(/^!(.+)/);
        if (filter in data || (exclude && exclude[1] in data)) {
            if ((exclude && new RegExp(filters[filter]).test(data[exclude[1]]))
                || (!exclude && !(new RegExp(filters[filter]).test(data[filter])))) {
                Zabbix.log(4, '[ Kubernetes discovery ] Discarded "' + name + '" by filter "' + filter + ': ' + filters[filter] + '"');

                filtered = false;
                return true;
            }
        }
    });

    return filtered;
}

try {
    var input = JSON.parse(value),
        output = [];

    if (typeof input !== 'object' || typeof input.items === 'undefined') {
        Zabbix.log(4, '[ Kubernetes ] Received incorrect JSON: ' + value);
        throw 'Incorrect JSON. Check debug log for more information.';
    }

    const api_url = 'https://api.okd.slips.pl:6443';
    var match = api_url.match(/(?:(https?):\/\/)([^:/]+)(?::(\d+))/);
    if (!match) {
        Zabbix.log(4, '[ Kubernetes ] Received incorrect Kubernetes API url: ' + api_url + '. Expected format: <scheme>://<host>:<port>');
        throw 'Cannot get hostname from Kubernetes API url. Check debug log for more information.';
    };
    const api_hostname = match[2];

    var filterLabels = parseFilters('!kubernetes.io/hostname: \\w+-[1-2],  node-role.kubernetes.io/master: .*, dope'),
        filterAnnotations = parseFilters('{$KUBE.NODE.FILTER.ANNOTATIONS}');

    input.items.forEach(function (node) {
        if (filter(node.metadata.name, node.metadata.labels, filterLabels)
            && filter(node.metadata.name, node.metadata.annotations, filterAnnotations)) {
            Zabbix.log(4, '[ Kubernetes discovery ] Filtered node "' + node.metadata.name + '"');

            var internalIPs = node.status.addresses.filter(function (addr) {
                return addr.type === 'InternalIP';
            });

            var internalIP = internalIPs.length && internalIPs[0].address;

            if (!(internalIP in input.endpointIPs)) {
                Zabbix.log(4, '[ Kubernetes discovery ] Node "' + node.metadata.name + '" is not included in the list of endpoint IPs');
                return;
            }

            output.push({
                '{#NAME}': node.metadata.name,
                '{#IP}': internalIP,
                '{#ROLES}': node.status.roles,
                '{#ARCH}': node.metadata.labels['kubernetes.io/arch'] || '',
                '{#OS}': node.metadata.labels['kubernetes.io/os'] || '',
                '{#CLUSTER_HOSTNAME}': api_hostname
            });
        }
    });

    return JSON.stringify(output);
}
catch (error) {
    error += (String(error).endsWith('.')) ? '' : '.';
    Zabbix.log(3, '[ Kubernetes discovery ] ERROR: ' + error);
    throw 'Discovery error: ' + error;
}
